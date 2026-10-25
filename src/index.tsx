import {
  DropdownItem,
  Field,
  PanelSection,
  PanelSectionRow,
  definePlugin,
  staticClasses,
} from "@decky/ui";
import { callable, toaster } from "@decky/api";
import { useState, useEffect, useCallback, useRef, FC } from "react";
import { FaHeadphones } from "react-icons/fa";

interface BatteryInfo {
  left: number;
  right: number;
  case: number;
  left_charging: boolean;
  right_charging: boolean;
  case_charging: boolean;
}

interface AncInfo {
  mode: string;
  adaptive_supported: boolean;
}

const getBattery = callable<[], BatteryInfo>("get_battery");
const getAnc = callable<[], AncInfo>("get_anc");
const setAnc = callable<[mode: string], boolean>("set_anc");
const isBluetoothOn = callable<[], boolean>("is_bluetooth_on");

const ANC_OPTIONS = [
  { data: "active", label: "Noise Cancellation" },
  { data: "off", label: "Off" },
  { data: "aware", label: "Aware" },
  { data: "adaptive", label: "Adaptive" },
];

const BatteryRow: FC<{ label: string; percent: number; charging: boolean }> = ({
  label, percent, charging,
}) => (
  <PanelSectionRow>
    <Field label={label} description={charging ? "Charging" : undefined}>
      {percent < 0 ? "Unknown" : `${percent}%`}
    </Field>
  </PanelSectionRow>
);

const Content: FC = () => {
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  const [ancMode, setAncMode] = useState<string>("unknown");
  const [adaptiveSupported, setAdaptiveSupported] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);
  const [btOn, setBtOn] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [changingAnc, setChangingAnc] = useState<boolean>(false);
  const pollingRef = useRef(false);
  // Discard a poll's ANC result if a user action overlapped it.
  const ancChangesRef = useRef(0);
  const ancPendingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const bt = await isBluetoothOn();
      setBtOn(bt);
      if (!bt) {
        setConnected(false);
        return;
      }
      const changes = ancChangesRef.current;
      const bat = await getBattery();
      const anc = await getAnc();
      setBattery(bat);
      if (!ancPendingRef.current && ancChangesRef.current === changes) {
        setAncMode(anc.mode);
      }
      setAdaptiveSupported(anc.adaptive_supported);
      setConnected(true);
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
      pollingRef.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const selectAnc = useCallback(async (mode: string) => {
    if (ancPendingRef.current) return;
    ancChangesRef.current++;
    ancPendingRef.current = true;
    setChangingAnc(true);
    setAncMode(mode);
    try {
      if (!await setAnc(mode)) throw new Error("Noise control change rejected");
    } catch {
      toaster.toast({ title: "Pixel Buddy", body: "Couldn't change noise control" });
      try {
        setAncMode((await getAnc()).mode);
      } catch {
        setAncMode("unknown");
      }
    } finally {
      ancPendingRef.current = false;
      setChangingAnc(false);
    }
  }, []);

  if (loading || !connected) {
    const title = loading ? "Connecting…" : !btOn ? "Bluetooth Off" : "Not Connected";
    const description = !btOn
      ? "Turn on Bluetooth in Steam settings to connect your Pixel Buds."
      : "Once paired with your Steam Deck and taken out of the case, your Pixel Buds will be detected automatically.";

    return (
      <PanelSection title="Pixel Buds" spinner={loading}>
        <PanelSectionRow>
          <Field label={title} description={description} />
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <>
      <PanelSection title="Battery">
        <BatteryRow label="Left earbud" percent={battery?.left ?? -1} charging={battery?.left_charging ?? false} />
        <BatteryRow label="Right earbud" percent={battery?.right ?? -1} charging={battery?.right_charging ?? false} />
        <BatteryRow label="Case" percent={battery?.case ?? -1} charging={battery?.case_charging ?? false} />
      </PanelSection>
      <PanelSection title="Noise Control">
        <PanelSectionRow>
          <DropdownItem
            label="Mode"
            menuLabel="Noise Control"
            layout="below"
            rgOptions={ANC_OPTIONS.filter(option =>
              option.data !== "adaptive" || adaptiveSupported || ancMode === "adaptive"
            )}
            selectedOption={ancMode}
            strDefaultLabel="Unknown"
            disabled={changingAnc || ancMode === "unknown"}
            onChange={option => { void selectAnc(option.data); }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Status">Connected</Field>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};

export default definePlugin(() => ({
  name: "Pixel Buddy",
  titleView: <div className={staticClasses.Title}>Pixel Buddy</div>,
  content: <Content />,
  icon: <FaHeadphones />,
  onDismount() {},
}));
