import asyncio
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, call, patch

with patch.dict(sys.modules, {"decky": SimpleNamespace(logger=Mock())}):
    import main as backend
    from main import MAESTRO_UUID, Plugin


FIRST = "AA:BB:CC:DD:EE:01"
SECOND = "AA:BB:CC:DD:EE:02"
CONTROLLER = "AA:BB:CC:DD:EE:03"
BATTERY = "case: unknown\nleft bud: 75% (not charging)\nright bud: 90% (charging)\n"


def device_info(name="Pixel Buds Pro", connected="yes", device_class="0x240404"):
    return (
        f"Name: {name}\nClass: {device_class}\nConnected: {connected}\n"
        f"UUID: Vendor specific ({MAESTRO_UUID})\n"
    )


class DeviceIdentificationTests(unittest.TestCase):
    def test_service_class_flags_do_not_gate_connection(self):
        for device_class in ("0x240404", "0x244404", "0x200404", "0x340404", "0x000000"):
            with self.subTest(device_class=device_class):
                self.assertTrue(Plugin._is_connected_buds(device_info(device_class=device_class)))

    def test_class_and_model_name_are_not_required_for_connection(self):
        self.assertTrue(Plugin._is_connected_buds(
            f"Name: My headphones\nConnected: yes\nUUID: ({MAESTRO_UUID.upper()})\n"
        ))

    def test_disconnected_buds_and_other_devices_are_rejected(self):
        self.assertFalse(Plugin._is_connected_buds(device_info(connected="no")))
        self.assertFalse(Plugin._is_connected_buds("Name: Pixel Buds Pro\nConnected: yes\n"))
        self.assertFalse(Plugin._is_connected_buds(f"Connected: yesterday\n{MAESTRO_UUID}"))


class BackendTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.plugin = Plugin()
        self.plugin._lock = asyncio.Lock()
        self.plugin._buds = None
        self.plugin.pbpctrl_path = "/plugin/bin/pbpctrl"
        self.plugin._run_bluetoothctl = AsyncMock()
        self.plugin._run_pbpctrl_locked = AsyncMock()
        exists = patch.object(backend.os.path, "exists", return_value=True)
        exists.start()
        self.addCleanup(exists.stop)

    def discovery(self, address=FIRST, name="Pixel Buds Pro", device_class="0x240404"):
        self.plugin._run_bluetoothctl.side_effect = [
            f"Device {address} {name}\nDevice {CONTROLLER} Controller\n",
            device_info(name=name, device_class=device_class),
        ]

    async def test_battery_and_anc_polls_share_one_discovery(self):
        self.discovery(name="Pixel Buds Pro 2", device_class="0x200404")
        self.plugin._run_pbpctrl_locked.side_effect = [BATTERY, "active", BATTERY, "off"]
        for expected_mode in ("active", "off"):
            battery = await self.plugin.get_battery()
            anc = await self.plugin.get_anc()
            self.assertEqual(battery["left"], 75)
            self.assertEqual(battery["case"], -1)
            self.assertTrue(battery["right_charging"])
            self.assertEqual(anc, {"mode": expected_mode, "adaptive_supported": True})
        self.assertEqual(self.plugin._run_bluetoothctl.await_args_list, [
            call("devices", "Connected"), call("info", FIRST),
        ])
        self.assertEqual(self.plugin._run_pbpctrl_locked.await_args_list, [
            call("--device", FIRST, "show", "battery"),
            call("--device", FIRST, "get", "anc"),
        ] * 2)

    async def test_concurrent_requests_share_discovery_and_serialize_commands(self):
        self.discovery()
        active = 0
        peak = 0

        async def command(*args):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0)
            active -= 1
            return BATTERY if args[-1] == "battery" else "off"

        self.plugin._run_pbpctrl_locked.side_effect = command
        await asyncio.gather(self.plugin.get_battery(), self.plugin.get_anc())
        self.assertEqual(peak, 1)
        self.assertEqual(self.plugin._run_bluetoothctl.await_count, 2)

    async def test_failed_cached_command_rediscovers_and_resets_model(self):
        self.discovery(name="Pixel Buds Pro 2")
        self.plugin._run_pbpctrl_locked.side_effect = ["active", Exception("pbpctrl timed out"), "off"]
        self.assertTrue((await self.plugin.get_anc())["adaptive_supported"])
        with self.assertRaisesRegex(Exception, "timed out"):
            await self.plugin.get_battery()
        self.discovery(address=SECOND)
        self.assertEqual(await self.plugin.get_anc(), {"mode": "off", "adaptive_supported": False})
        self.plugin._run_pbpctrl_locked.assert_awaited_with("--device", SECOND, "get", "anc")
        self.assertEqual(self.plugin._run_bluetoothctl.await_count, 4)

    async def test_failed_first_command_is_not_cached(self):
        self.discovery()
        self.plugin._run_pbpctrl_locked.side_effect = [Exception("Disconnected"), BATTERY]
        with self.assertRaisesRegex(Exception, "Disconnected"):
            await self.plugin.get_battery()
        self.discovery(address=SECOND)
        await self.plugin.get_battery()
        self.plugin._run_pbpctrl_locked.assert_awaited_with("--device", SECOND, "show", "battery")

    async def test_no_buds_are_not_cached_and_later_connection_is_discovered(self):
        self.plugin._run_bluetoothctl.return_value = ""
        with self.assertRaisesRegex(Exception, "no connected Pixel Buds"):
            await self.plugin.get_battery()
        self.plugin._run_pbpctrl_locked.assert_not_awaited()
        self.discovery()
        self.plugin._run_pbpctrl_locked.return_value = BATTERY
        self.assertEqual((await self.plugin.get_battery())["right"], 90)

    async def test_bluetooth_off_invalidates_cached_device(self):
        self.discovery(name="Pixel Buds Pro 2")
        self.plugin._run_pbpctrl_locked.side_effect = ["active", "off"]
        await self.plugin.get_anc()
        self.plugin._run_bluetoothctl.side_effect = ["Powered: no"]
        self.assertFalse(await self.plugin.is_bluetooth_on())
        self.discovery(address=SECOND)
        self.assertFalse((await self.plugin.get_anc())["adaptive_supported"])
        self.plugin._run_pbpctrl_locked.assert_awaited_with("--device", SECOND, "get", "anc")

    async def test_bluetooth_on_does_not_force_discovery_again(self):
        self.discovery()
        self.plugin._run_pbpctrl_locked.return_value = BATTERY
        await self.plugin.get_battery()
        self.plugin._run_bluetoothctl.side_effect = ["Powered: yes"]
        self.assertTrue(await self.plugin.is_bluetooth_on())
        await self.plugin.get_battery()
        self.assertEqual(self.plugin._run_bluetoothctl.await_count, 3)

    async def test_unrelated_device_disappearing_does_not_block_buds(self):
        self.plugin._run_bluetoothctl.side_effect = [
            f"Device {CONTROLLER} Controller\nDevice {FIRST.lower()} Buds\nDevice {FIRST} Buds\n",
            Exception("Device not available"), device_info(),
        ]
        self.plugin._run_pbpctrl_locked.return_value = BATTERY
        await self.plugin.get_battery()
        self.assertEqual(self.plugin._run_bluetoothctl.await_args_list, [
            call("devices", "Connected"), call("info", CONTROLLER), call("info", FIRST),
        ])

    async def test_disconnected_known_buds_are_skipped(self):
        self.plugin._run_bluetoothctl.side_effect = [
            f"Device {FIRST} Old buds\nDevice {SECOND} Current buds\n",
            device_info(connected="no"), device_info(),
        ]
        self.plugin._run_pbpctrl_locked.return_value = BATTERY
        await self.plugin.get_battery()
        self.plugin._run_pbpctrl_locked.assert_awaited_with("--device", SECOND, "show", "battery")

    async def test_current_adaptive_mode_remembers_support_for_renamed_buds(self):
        self.discovery(name="My earbuds")
        self.plugin._run_pbpctrl_locked.side_effect = ["warning: retrying\nadaptive", "off"]
        self.assertEqual(await self.plugin.get_anc(), {"mode": "adaptive", "adaptive_supported": True})
        self.assertEqual(await self.plugin.get_anc(), {"mode": "off", "adaptive_supported": True})

    async def test_device_class_does_not_imply_adaptive_support(self):
        self.discovery(device_class="0x244404")
        self.plugin._run_pbpctrl_locked.return_value = "active"
        self.assertFalse((await self.plugin.get_anc())["adaptive_supported"])

    async def test_anc_write_reuses_address_and_invalidates_on_failure(self):
        self.discovery()
        self.plugin._run_pbpctrl_locked.side_effect = [BATTERY, Exception("Disconnected"), "off"]
        await self.plugin.get_battery()
        with self.assertRaisesRegex(Exception, "Disconnected"):
            await self.plugin.set_anc("active")
        self.plugin._run_pbpctrl_locked.assert_awaited_with("--device", FIRST, "set", "anc", "active")
        self.discovery(address=SECOND)
        await self.plugin.get_anc()
        self.plugin._run_pbpctrl_locked.assert_awaited_with("--device", SECOND, "get", "anc")

    async def test_timed_out_process_is_killed_and_next_call_rediscovers(self):
        self.discovery()
        proc = Mock()
        proc.communicate = AsyncMock(side_effect=asyncio.TimeoutError)
        proc.wait = AsyncMock()
        with patch.object(backend.asyncio, "create_subprocess_exec", AsyncMock(return_value=proc)):
            del self.plugin._run_pbpctrl_locked
            with self.assertRaisesRegex(Exception, "pbpctrl timed out"):
                await self.plugin.get_battery()
        proc.kill.assert_called_once()
        proc.wait.assert_awaited_once()
        self.discovery(address=SECOND)
        self.plugin._run_pbpctrl_locked = AsyncMock(return_value=BATTERY)
        await self.plugin.get_battery()
        self.plugin._run_pbpctrl_locked.assert_awaited_with("--device", SECOND, "show", "battery")


if __name__ == "__main__":
    unittest.main()
