import os
import re
import asyncio
from typing import NamedTuple, Optional

import decky

# Service UUID used by the Pixel Buds Maestro protocol.
MAESTRO_UUID = "25e97ff7-24ce-4c4c-8951-f764a708f7b5"


class ConnectedBuds(NamedTuple):
    address: str
    adaptive_supported: bool


def _system_env() -> dict:
    """Environment for running system programs from the plugin."""
    # Decky runs plugins from a bundled runtime that puts its own libraries on
    # LD_LIBRARY_PATH, and programs we start inherit it. Those libraries can
    # need a newer glibc than SteamOS has (on 3.8, bluetoothctl fails to start),
    # so restore the system's library path, as Decky does for its own commands.
    env = dict(os.environ)
    original = env.pop("LD_LIBRARY_PATH_ORIG", None)
    if original:
        env["LD_LIBRARY_PATH"] = original
    else:
        env.pop("LD_LIBRARY_PATH", None)
    return env


class Plugin:
    pbpctrl_path: str = ""
    _lock: asyncio.Lock
    _buds: Optional[ConnectedBuds] = None

    async def _main(self):
        self._lock = asyncio.Lock()
        self._buds = None
        self.pbpctrl_path = os.path.join(decky.DECKY_PLUGIN_DIR, "bin", "pbpctrl")
        if os.path.exists(self.pbpctrl_path):
            os.chmod(self.pbpctrl_path, 0o755)
            decky.logger.info(f"pbpctrl found at {self.pbpctrl_path}")
        else:
            decky.logger.error(f"pbpctrl not found at {self.pbpctrl_path}")

    async def _unload(self):
        pass

    async def _uninstall(self):
        pass

    async def _migration(self):
        pass

    async def get_battery(self) -> dict:
        output = await self._run_pbpctrl("show", "battery")
        return self._parse_battery(output)

    async def get_anc(self) -> dict:
        output = await self._run_pbpctrl("get", "anc")
        # pbpctrl logs warnings (e.g. connection retries) to stdout before the value
        lines = output.strip().splitlines()
        raw = lines[-1].strip().lower() if lines else ""
        # pbpctrl returns named values or "unknown (N)" with numeric codes
        mode = raw if raw in ("off", "active", "aware", "adaptive") else "unknown"
        # A reported adaptive mode also identifies support when the device has
        # been renamed and its Bluetooth name no longer contains the model.
        if mode == "adaptive" and self._buds is not None:
            self._buds = self._buds._replace(adaptive_supported=True)
        return {
            "mode": mode,
            "adaptive_supported": self._buds is not None and self._buds.adaptive_supported,
        }

    async def set_anc(self, mode: str) -> bool:
        mode_map = {
            "off": "off",
            "active": "active",
            "aware": "aware",
            "adaptive": "adaptive",
        }
        pbpctrl_mode = mode_map.get(mode.lower())
        if not pbpctrl_mode:
            decky.logger.error(f"Unknown ANC mode: {mode}")
            return False
        await self._run_pbpctrl("set", "anc", pbpctrl_mode)
        return True

    async def is_connected(self) -> bool:
        try:
            await self._run_pbpctrl("show", "battery")
            return True
        except Exception:
            return False

    async def is_bluetooth_on(self) -> bool:
        async with self._lock:
            try:
                powered = "Powered: yes" in await self._run_bluetoothctl("show")
                if not powered:
                    self._buds = None
                return powered
            except Exception:
                return True  # assume on if we can't check

    async def get_device_info(self) -> dict:
        try:
            software = await self._run_pbpctrl("show", "software")
        except Exception:
            software = ""
        try:
            hardware = await self._run_pbpctrl("show", "hardware")
        except Exception:
            hardware = ""
        return {"software": software.strip(), "hardware": hardware.strip()}

    async def _run_pbpctrl(self, *args: str) -> str:
        if not os.path.exists(self.pbpctrl_path):
            raise Exception("pbpctrl binary not found")

        # Keep discovery under the same lock as the RFCOMM command so battery,
        # ANC and user actions share one cached device, even on first connection.
        async with self._lock:
            buds = self._buds or await self._find_buds()
            if buds is None:
                raise Exception("no connected Pixel Buds found")
            try:
                output = await self._run_pbpctrl_locked("--device", buds.address, *args)
            except Exception:
                # The next call rediscovers the connected pair after a timeout,
                # disconnect or other command failure. Do not retain stale support.
                self._buds = None
                raise
            self._buds = buds
            return output

    async def _run_pbpctrl_locked(self, *args: str) -> str:
        cmd = [self.pbpctrl_path] + list(args)
        decky.logger.info(f"Running: {' '.join(cmd)}")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_system_env(),
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10.0)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise Exception("pbpctrl timed out")

        if proc.returncode != 0:
            err = stderr.decode().strip()
            decky.logger.error(f"pbpctrl error: {err}")
            raise Exception(f"pbpctrl failed: {err}")

        return stdout.decode()

    async def _find_buds(self) -> Optional[ConnectedBuds]:
        """Resolve connected Pixel Buds and their advertised model once."""
        # Without --device, pbpctrl uses the first paired Pixel Buds it finds,
        # connected or not, and the search order is random on every run. With
        # an old pair still paired, it would sometimes try to connect to those
        # and time out. Find the connected pair here instead.
        devices = await self._run_bluetoothctl("devices", "Connected")
        addresses = list(dict.fromkeys(
            address.upper() for address in re.findall(
                r"Device ((?:[0-9A-F]{2}:){5}[0-9A-F]{2})", devices, re.IGNORECASE
            )
        ))
        for address in addresses:
            try:
                info = await self._run_bluetoothctl("info", address)
            except Exception:
                # Another device may disappear between listing and inspection.
                continue
            if self._is_connected_buds(info):
                model = re.search(r"^\s*Name:\s*(.+)$", info, re.MULTILINE)
                adaptive_supported = model is not None and re.search(
                    r"\bpixel buds pro 2\b", model.group(1), re.IGNORECASE
                ) is not None
                return ConnectedBuds(address, adaptive_supported)
        return None

    async def _run_bluetoothctl(self, *args: str) -> str:
        proc = await asyncio.create_subprocess_exec(
            "bluetoothctl", *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_system_env(),
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise Exception("bluetoothctl timed out")

        if proc.returncode != 0:
            err = stderr.decode(errors="replace").strip()
            raise Exception(f"bluetoothctl {' '.join(args)} failed: {err}")

        return stdout.decode(errors="replace")

    @staticmethod
    def _is_connected_buds(info: str) -> bool:
        """Identify connected buds by service UUID, regardless of CoD flags."""
        return (
            re.search(r"^\s*Connected:\s+yes\s*$", info, re.MULTILINE) is not None
            and MAESTRO_UUID in info.lower()
        )

    @staticmethod
    def _parse_battery(output: str) -> dict:
        result = {
            "left": -1,
            "right": -1,
            "case": -1,
            "left_charging": False,
            "right_charging": False,
            "case_charging": False,
        }
        for line in output.strip().split("\n"):
            match = re.match(
                r"\s*(case|left bud|right bud):\s+(\d+%\s+\(.+?\)|unknown)", line
            )
            if not match:
                continue
            component = match.group(1)
            value = match.group(2)
            if value == "unknown":
                continue
            pct_match = re.match(r"(\d+)%\s+\((.+?)\)", value)
            if not pct_match:
                continue
            percent = int(pct_match.group(1))
            charging = pct_match.group(2).strip() == "charging"
            if component == "case":
                result["case"] = percent
                result["case_charging"] = charging
            elif component == "left bud":
                result["left"] = percent
                result["left_charging"] = charging
            elif component == "right bud":
                result["right"] = percent
                result["right_charging"] = charging
        return result
