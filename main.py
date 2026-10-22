import os
import re
import asyncio
from typing import Optional, Tuple

import decky

# Service UUID pbpctrl connects to, and the device classes it accepts
# (Pixel Buds Pro, Pixel Buds Pro 2)
MAESTRO_UUID = "25e97ff7-24ce-4c4c-8951-f764a708f7b5"
PIXEL_BUDS_PRO_CLASS = 0x240404
PIXEL_BUDS_PRO_2_CLASS = 0x244404
PIXEL_BUDS_CLASSES = (PIXEL_BUDS_PRO_CLASS, PIXEL_BUDS_PRO_2_CLASS)


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
    _lock: asyncio.Lock = None
    # Device class of the buds pbpctrl last ran against
    _buds_class: int = 0

    async def _main(self):
        self._lock = asyncio.Lock()
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
        return {
            "mode": mode,
            # Only the Pixel Buds Pro 2 have adaptive noise cancellation
            "adaptive_supported": self._buds_class == PIXEL_BUDS_PRO_2_CLASS,
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
        try:
            return "Powered: yes" in await self._run_bluetoothctl("show")
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

        buds = await self._find_buds()
        if buds is None:
            raise Exception("no connected Pixel Buds found")
        address, self._buds_class = buds

        async with self._lock:
            return await self._run_pbpctrl_locked("--device", address, *args)

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

    async def _find_buds(self) -> Optional[Tuple[str, int]]:
        """Return the address and device class of the connected Pixel Buds."""
        # Without --device, pbpctrl uses the first paired Pixel Buds it finds,
        # connected or not, and the search order is random on every run. With
        # an old pair still paired, it would sometimes try to connect to those
        # and time out. Find the connected pair here instead.
        devices = await self._run_bluetoothctl("devices", "Connected")
        addresses = list(dict.fromkeys(
            re.findall(r"Device ((?:[0-9A-F]{2}:){5}[0-9A-F]{2})", devices)
        ))
        infos = await asyncio.gather(
            *(self._run_bluetoothctl("info", address) for address in addresses)
        )
        for address, info in zip(addresses, infos):
            device_class = self._connected_buds_class(info)
            if device_class is not None:
                return address, device_class
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
    def _connected_buds_class(info: str) -> Optional[int]:
        """Return the device class if `bluetoothctl info` shows connected Pixel Buds."""
        class_match = re.search(r"Class:\s+0x([0-9a-fA-F]+)", info)
        if class_match is None or "Connected: yes" not in info or MAESTRO_UUID not in info.lower():
            return None
        device_class = int(class_match.group(1), 16)
        return device_class if device_class in PIXEL_BUDS_CLASSES else None

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
