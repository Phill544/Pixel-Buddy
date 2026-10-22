import {
  PanelSection,
  Focusable,
  definePlugin,
  staticClasses,
} from "@decky/ui";
import { callable } from "@decky/api";
import { useState, useEffect, useCallback, useRef, FC, CSSProperties } from "react";
import { FaHeadphones } from "react-icons/fa";

// ── Theme constants ──

const ACCENT = "#1a9fff";
const ACCENT_BG = "rgba(26, 159, 255, 0.09)";

// ── Types ──

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

// ── Backend calls ──

const getBattery = callable<[], BatteryInfo>("get_battery");
const getAnc = callable<[], AncInfo>("get_anc");
const setAnc = callable<[mode: string], boolean>("set_anc");
const isBluetoothOn = callable<[], boolean>("is_bluetooth_on");

// ── Battery Icon ──

function batteryColor(percent: number): string {
  if (percent < 0) return "currentColor";
  if (percent <= 10) return "#e74c3c";
  if (percent <= 25) return "#f39c12";
  return "#2ecc71";
}

const BatteryIcon: FC<{ percent: number; charging: boolean; size?: number }> = ({
  percent,
  charging,
  size = 38,
}) => {
  const w = size;
  const h = size * 0.5;
  const bodyW = w * 0.88;
  const bodyH = h;
  const r = h * 0.18;
  const tipW = w * 0.08;
  const tipH = h * 0.35;
  const pad = 1.5;
  const innerMaxW = bodyW - pad * 2 - 1;
  const fillW = percent < 0 ? 0 : Math.max(0, Math.min(1, percent / 100)) * innerMaxW;
  const color = batteryColor(percent);
  const bx = bodyW * 0.3;
  const by = h * 0.12;
  const bw = bodyW * 0.38;
  const bh = h * 0.76;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <rect x={0.5} y={0.5} width={bodyW - 1} height={bodyH - 1}
            rx={r} ry={r} fill="none" stroke="currentColor" strokeWidth={1.2} opacity={0.4} />
      <rect x={bodyW} y={(h - tipH) / 2} width={tipW} height={tipH}
            rx={tipW * 0.4} ry={tipW * 0.4} fill="currentColor" opacity={0.4} />
      {percent >= 0 && (
        <rect x={pad + 0.5} y={pad + 0.5}
              width={fillW} height={bodyH - pad * 2 - 1}
              rx={r * 0.6} ry={r * 0.6} fill={color} />
      )}
      {charging && (
        <polygon
          points={`${bx + bw * 0.55},${by} ${bx + bw * 0.2},${by + bh * 0.52} ${bx + bw * 0.48},${by + bh * 0.48} ${bx + bw * 0.42},${by + bh} ${bx + bw * 0.8},${by + bh * 0.42} ${bx + bw * 0.52},${by + bh * 0.46}`}
          fill="#fff" stroke={color} strokeWidth={0.3}
        />
      )}
      {percent < 0 && (
        <text x={bodyW / 2} y={h / 2 + 1} textAnchor="middle" dominantBaseline="middle"
              fill="currentColor" opacity={0.3} fontSize={h * 0.5} fontWeight="bold">?</text>
      )}
    </svg>
  );
};

// ── Battery Card + Grid ──

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  flex: "1 1 0",
  minWidth: 0,
  padding: "12px 4px 10px",
  background: "rgba(255, 255, 255, 0.06)",
  borderRadius: 8,
};

const cardLabelStyle: CSSProperties = {
  fontSize: 11,
  opacity: 0.5,
  textTransform: "uppercase",
  letterSpacing: "0.6px",
  fontWeight: 600,
};

const BatteryCard: FC<{ label: string; percent: number; charging: boolean }> = ({
  label, percent, charging,
}) => {
  const color = batteryColor(percent);
  const text = percent < 0 ? "--" : `${percent}%`;
  return (
    <div style={cardStyle}>
      <span style={cardLabelStyle}>{label}</span>
      <BatteryIcon percent={percent} charging={charging} size={38} />
      <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color }}>{text}</span>
    </div>
  );
};

const BatteryGrid: FC<{ battery: BatteryInfo | null }> = ({ battery }) => (
  <div style={{ display: "flex", justifyContent: "space-around", gap: 8, padding: "8px 0 4px" }}>
    <BatteryCard label="Left" percent={battery?.left ?? -1} charging={battery?.left_charging ?? false} />
    <BatteryCard label="Right" percent={battery?.right ?? -1} charging={battery?.right_charging ?? false} />
    <BatteryCard label="Case" percent={battery?.case ?? -1} charging={battery?.case_charging ?? false} />
  </div>
);

// ── Material Symbol Icons (Google Material Symbols Rounded, filled) ──

const IconBluetoothDisabled: FC<{ size?: number; style?: CSSProperties }> = ({ size = 48, style }) => (
  <svg width={size} height={size} viewBox="0 -960 960 960" fill="currentColor" style={style}>
    <path d="M440-384 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l168-168L84-764q-11-11-11-28t11-28q11-11 28-11t28 11l680 680q11 11 11 28t-11 28q-11 11-28 11t-28-11L624-224 508-108q-6 6-13 9t-15 3q-16 0-28-11.5T440-137v-247Zm80 150 46-46-46-46v92Zm44-274-56-56 88-88-76-74v174l-80-80v-191q0-18 12-29.5t28-11.5q8 0 15 3t13 9l172 172q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L564-508Z"/>
  </svg>
);

// ── ANC Icons ──

const IconNoiseControlOn: FC<{ size?: number }> = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 -960 960 960" fill="currentColor">
    <path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm39-80q-39 0-70-24t-45-62q-3-8-6.5-15.5T388-355l-50-51q-26-26-42-60t-16-72q0-75 52.5-128.5T460-720q52 0 95.5 27.5T622-618q10 20-1.5 39T586-560q-12 0-21.5-6.5T550-584q-13-26-37-41t-53-15q-42 0-71 29t-29 71q0 21 7.5 40t22.5 34l55 54q14 14 22.5 30.5T482-347q5 12 15 19.5t23 7.5q11 0 20.5-5.5T555-341q5-9 14-14t20-5q23 0 35 19t1 39q-16 29-44.5 45.5T519-240Zm21-160q25 0 42.5-17.5T600-460q0-25-17.5-42.5T540-520q-25 0-42.5 17.5T480-460q0 25 17.5 42.5T540-400Z"/>
  </svg>
);

const IconNoiseControlOff: FC<{ size?: number }> = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 -960 960 960" fill="currentColor">
    <path d="M480-80q-50 0-90-9.5T313-116q-16-8-22-24.5t2-31.5q8-15 25-18.5t33 3.5q30 13 62 20t67 7q35 0 67-7t62-20q16-7 33-3.5t25 18.5q8 15 2 31.5T647-116q-37 17-77 26.5T480-80ZM160-480q0 35 7 67t20 62q7 16 3.5 33T172-293q-15 8-31.5 2T116-313q-17-37-26.5-77T80-480q0-50 9.5-90t26.5-77q8-16 24.5-22t31.5 2q15 8 18.5 25t-3.5 33q-13 30-20 62t-7 67Zm640 0q0-35-7-67t-20-62q-7-16-3.5-33t18.5-25q15-8 31.5-2t24.5 22q17 37 26.5 77t9.5 90q0 50-9.5 90T844-313q-8 16-24.5 22t-31.5-2q-15-8-18.5-25t3.5-33q13-30 20-62t7-67ZM480-800q-35 0-67 7t-62 20q-16 7-33 3.5T293-788q-8-15-2-31.5t22-24.5q37-17 77-26.5t90-9.5q50 0 90 9.5t77 26.5q16 8 22 24.5t-2 31.5q-8 15-25 18.5t-33-3.5q-30-13-62-20t-67-7Zm39 560q-39 0-70-24t-45-62q-3-8-6.5-15.5T388-355l-50-51q-26-26-42-60t-16-72q0-75 52.5-128.5T460-720q52 0 95.5 27.5T622-618q10 20-1.5 39T586-560q-12 0-21.5-6.5T550-584q-13-26-37-41t-53-15q-42 0-71 29t-29 71q0 21 7.5 40t22.5 34l55 54q14 14 22.5 30.5T482-347q5 12 15 19.5t23 7.5q11 0 20.5-5.5T555-341q5-9 14-14t20-5q23 0 35 19t1 39q-16 29-44.5 45.5T519-240Zm21-160q25 0 42.5-17.5T600-460q0-25-17.5-42.5T540-520q-25 0-42.5 17.5T480-460q0 25 17.5 42.5T540-400Z"/>
  </svg>
);

const IconNoiseAware: FC<{ size?: number }> = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 -960 960 960" fill="currentColor">
    <path d="M480-800q-17 0-28.5-11.5T440-840q0-17 11.5-28.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800Zm0 720q-17 0-28.5-11.5T440-120q0-17 11.5-28.5T480-160q17 0 28.5 11.5T520-120q0 17-11.5 28.5T480-80ZM199-665q-17 0-28.5-11.5T159-705q0-17 11.5-28.5T199-745q17 0 28.5 11.5T239-705q0 17-11.5 28.5T199-665Zm562 450q-17 0-28.5-11.5T721-255q0-17 11.5-28.5T761-295q17 0 28.5 11.5T801-255q0 17-11.5 28.5T761-215ZM129-360q-17 0-28.5-11.5T89-400q0-17 11.5-28.5T129-440q17 0 28.5 11.5T169-400q0 17-11.5 28.5T129-360Zm702-160q-17 0-28.5-11.5T791-560q0-17 11.5-28.5T831-600q17 0 28.5 11.5T871-560q0 17-11.5 28.5T831-520ZM324-115q-17 0-28.5-11.5T284-155q0-17 11.5-28.5T324-195q17 0 28.5 11.5T364-155q0 17-11.5 28.5T324-115Zm312-650q-17 0-28.5-11.5T596-805q0-17 11.5-28.5T636-845q17 0 28.5 11.5T676-805q0 17-11.5 28.5T636-765Zm0 649q-17 0-28.5-11.5T596-156q0-17 11.5-28.5T636-196q17 0 28.5 11.5T676-156q0 17-11.5 28.5T636-116ZM324-765q-17 0-28.5-11.5T284-805q0-17 11.5-28.5T324-845q17 0 28.5 11.5T364-805q0 17-11.5 28.5T324-765Zm507 405q-17 0-28.5-11.5T791-400q0-17 11.5-28.5T831-440q17 0 28.5 11.5T871-400q0 17-11.5 28.5T831-360ZM128-520q-17 0-28.5-11.5T88-560q0-17 11.5-28.5T128-600q17 0 28.5 11.5T168-560q0 17-11.5 28.5T128-520Zm633-145q-17 0-28.5-11.5T721-705q0-17 11.5-28.5T761-745q17 0 28.5 11.5T801-705q0 17-11.5 28.5T761-665ZM199-215q-17 0-28.5-11.5T159-255q0-17 11.5-28.5T199-295q17 0 28.5 11.5T239-255q0 17-11.5 28.5T199-215Zm320-25q-39 0-70-24t-45-62q-3-8-6.5-15.5T388-355l-50-51q-26-26-42-60t-16-72q0-75 52.5-128.5T460-720q52 0 95.5 27.5T622-618q10 20-1.5 39T586-560q-12 0-21.5-6.5T550-584q-13-26-37-41t-53-15q-42 0-71 29t-29 71q0 21 7.5 40t22.5 34l55 54q14 14 22.5 30.5T482-347q5 12 15 19.5t23 7.5q11 0 20.5-5.5T555-341q5-9 14-14t20-5q23 0 35 19t1 39q-16 29-44.5 45.5T519-240Zm21-160q25 0 42.5-17.5T600-460q0-25-17.5-42.5T540-520q-25 0-42.5 17.5T480-460q0 25 17.5 42.5T540-400Z"/>
  </svg>
);

// No Material Symbol exists for adaptive noise control, so this pairs the ear
// shared by the icons above with the ring from `auto_mode`.
const IconNoiseControlAdaptive: FC<{ size?: number }> = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 -960 960 960" fill="currentColor">
    <path d="M120-228v68q0 17-11.5 28.5T80-120q-17 0-28.5-11.5T40-160v-160q0-17 11.5-28.5T80-360h160q17 0 28.5 11.5T280-320q0 17-11.5 28.5T240-280h-58q51 75 129.5 117.5T480-120q104 0 190-54t132-145q9-17 23.5-27t33.5-6q18 4 23.5 20.5T879-296q-54 116-161 186T480-40q-108 0-202.5-49.5T120-228ZM83-520q-17 0-27.5-12.5T48-562q10-47 26-86.5t43-79.5q10-15 26-17t29 11q14 14 14 30.5T175-670q-17 26-27 52t-18 57q-4 18-16.5 29.5T83-520Zm357-358q0 19-11.5 31T398-831q-30 7-55.5 18T291-785q-16 11-32.5 10T228-790q-12-12-10.5-27.5T233-844q39-26 77.5-42.5T396-912q18-3 31 7t13 27Zm294 88q-14 14-31 14.5T670-786q-26-17-52-27t-57-18q-18-4-29.5-16.5T520-878q0-17 12.5-27t29.5-7q48 9 87 25t79 43q14 10 16 26t-10 28Zm144 270q-19 0-31-11.5T831-562q-8-31-18.5-56.5T785-671q-11-16-10-32.5t15-30.5q12-12 27.5-10t26.5 16q27 40 43 79t25 87q3 17-7 29.5T878-520ZM519-240q-39 0-70-24t-45-62q-3-8-6.5-15.5T388-355l-50-51q-26-26-42-60t-16-72q0-75 52.5-128.5T460-720q52 0 95.5 27.5T622-618q10 20-1.5 39T586-560q-12 0-21.5-6.5T550-584q-13-26-37-41t-53-15q-42 0-71 29t-29 71q0 21 7.5 40t22.5 34l55 54q14 14 22.5 30.5T482-347q5 12 15 19.5t23 7.5q11 0 20.5-5.5T555-341q5-9 14-14t20-5q23 0 35 19t1 39q-16 29-44.5 45.5T519-240Zm21-160q25 0 42.5-17.5T600-460q0-25-17.5-42.5T540-520q-25 0-42.5 17.5T480-460q0 25 17.5 42.5T540-400Z"/>
  </svg>
);

// ── ANC Toggle Grid ──

interface AncMode {
  id: string;
  label: string;
  Icon: FC<{ size?: number }>;
}

const ANC_MODES: AncMode[] = [
  { id: "active", label: "Noise Cancel", Icon: IconNoiseControlOn },
  { id: "off",    label: "Off",          Icon: IconNoiseControlOff },
  { id: "aware",  label: "Aware", Icon: IconNoiseAware },
  { id: "adaptive", label: "Adaptive", Icon: IconNoiseControlAdaptive },
];

// Border is set via the shorthand in BOTH base and active so React's style
// diff always sees it as a single changed property and re-applies all three
// longhands together. Mixing `border` shorthand in one variant with a
// `borderColor` longhand in another leaves border-color cleared (falling back
// to currentColor — visibly grey/white) when transitioning back to base.
const ancCardBase: CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  padding: "12px 4px 10px",
  background: "rgba(255, 255, 255, 0.06)",
  borderRadius: 8,
  border: "2px solid transparent",
  cursor: "pointer",
  transition: "all 0.15s ease",
};

const ancCardActive: CSSProperties = {
  ...ancCardBase,
  border: `2px solid ${ACCENT}`,
  background: ACCENT_BG,
};

const ancCardDisabled: CSSProperties = {
  ...ancCardBase,
  opacity: 0.3,
  cursor: "default",
};

const ancLabelBase: CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  fontWeight: 600,
  textAlign: "center",
  lineHeight: 1.2,
  opacity: 0.5,
};

// With four modes (Pixel Buds Pro 2) the cards only just fit the panel, so
// tighten the spacing to keep the "Adaptive" label inside its card.
const ANC_COMPACT_GAP = 6;
const ancCardCompact: CSSProperties = { padding: "12px 2px 10px" };
const ancLabelCompact: CSSProperties = { letterSpacing: "0.3px" };

// SteamUI's `Focusable` strips `className` from its wrapper div but applies
// `.gpfocus` to the focused element imperatively. We wrap the grid in a plain
// `<div>` (which keeps our class) and scope CSS to descendants of that wrapper
// so we only style our cards, not every focused element on screen.
const ANC_WRAP_CLASS = "pb-anc-wrap";
const ANC_FADE_CLASS = "pb-anc-fade";
const ancFocusStyles = `
.${ANC_WRAP_CLASS} .gpfocus {
  background: rgba(255, 255, 255, 0.12) !important;
  border-color: rgba(255, 255, 255, 0.8) !important;
}
.${ANC_WRAP_CLASS} .gpfocus .${ANC_FADE_CLASS} {
  opacity: 1 !important;
}
`;

const AncToggleGrid: FC<{
  modes: AncMode[];
  selected: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
}> = ({
  modes, selected, disabled, onSelect,
}) => {
  const compact = modes.length > 3;
  const gap = compact ? ANC_COMPACT_GAP : 8;
  const cardCompact = compact ? ancCardCompact : {};
  const labelCompact = compact ? ancLabelCompact : {};

  if (disabled) {
    return (
      <div style={{ display: "flex", gap, padding: "8px 0 4px" }}>
        {modes.map(mode => (
          <div key={mode.id} style={{ ...ancCardDisabled, ...cardCompact }}>
            <span style={{ opacity: 0.5 }}><mode.Icon size={28} /></span>
            <span style={{ ...ancLabelBase, ...labelCompact }}>{mode.label}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={ANC_WRAP_CLASS}>
      <style>{ancFocusStyles}</style>
      {/* @ts-ignore - flow-children is a valid SP prop but not in the type defs */}
      <Focusable flow-children="horizontal" style={{ display: "flex", gap, padding: "8px 0 4px" }}>
        {modes.map(mode => {
          const isActive = selected === mode.id;
          const fadeClass = isActive ? "" : ANC_FADE_CLASS;
          return (
            <Focusable
              key={mode.id}
              onActivate={() => onSelect(mode.id)}
              style={{ ...(isActive ? ancCardActive : ancCardBase), ...cardCompact }}
            >
              <span className={fadeClass} style={{ color: isActive ? ACCENT : "inherit", opacity: isActive ? 1 : 0.5 }}>
                <mode.Icon size={28} />
              </span>
              <span className={fadeClass} style={{ ...ancLabelBase, ...labelCompact, color: isActive ? ACCENT : "inherit", opacity: isActive ? 1 : 0.5 }}>
                {mode.label}
              </span>
            </Focusable>
          );
        })}
      </Focusable>
    </div>
  );
};

// ── Main Content ──

const Content: FC = () => {
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  const [ancMode, setAncMode] = useState<string>("off");
  const [adaptiveSupported, setAdaptiveSupported] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);
  const [btOn, setBtOn] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const pollingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      // Check BT first — instant local call, avoids slow pbpctrl timeout if off
      const bt = await isBluetoothOn();
      setBtOn(bt);
      if (!bt) {
        setConnected(false);
        return;
      }
      const bat = await getBattery();
      setBattery(bat);
      setConnected(true);
      const anc = await getAnc();
      setAncMode(anc.mode);
      setAdaptiveSupported(anc.adaptive_supported);
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

  if (loading || !connected) {
    const title = loading ? "Connecting..." : !btOn ? "Bluetooth Off" : "Not Connected";
    const subtitle = !btOn
      ? "Turn on Bluetooth in Steam settings\nto connect your Pixel Buds"
      : "Pair your Pixel Buds via Bluetooth\nsettings, then open the case nearby";
    const dotColor = !btOn ? "#e74c3c" : ACCENT;
    const dotLabel = !btOn ? "Bluetooth disabled" : "Searching...";
    const shouldPulse = btOn;

    return (
      <>
        <style>{`
          @keyframes pbp-pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 1; }
          }
        `}</style>
        <PanelSection>
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "20px 16px 16px",
            gap: 12,
          }}>
            {!btOn
              ? <IconBluetoothDisabled size={48} style={{ opacity: 0.15 }} />
              : <FaHeadphones style={{ fontSize: 48, opacity: 0.15 }} />
            }
            <span style={{ fontSize: 14, fontWeight: 600, opacity: 0.8 }}>
              {title}
            </span>
            <span style={{ fontSize: 12, opacity: 0.4, textAlign: "center", lineHeight: 1.4, whiteSpace: "pre-line" }}>
              {subtitle}
            </span>
            <span style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              opacity: 0.5,
              marginTop: 4,
            }}>
              <span style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: dotColor,
                animation: shouldPulse ? "pbp-pulse 1.5s ease-in-out infinite" : "none",
              }} />
              {dotLabel}
            </span>
          </div>
        </PanelSection>
      </>
    );
  }

  return (
    <>
      <div style={{ height: 8 }} />
      <PanelSection>
        <BatteryGrid battery={battery} />
      </PanelSection>
      <div style={{ height: 4 }} />
      <PanelSection title="ANC">
        <AncToggleGrid
          modes={ANC_MODES.filter(mode =>
            mode.id !== "adaptive" || adaptiveSupported || ancMode === "adaptive"
          )}
          selected={ancMode}
          disabled={ancMode === "unknown"}
          onSelect={async (mode) => {
            setAncMode(mode);
            await setAnc(mode);
          }}
        />
      </PanelSection>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px 0 4px",
        opacity: 0.3,
        fontSize: 11,
        position: "relative",
      }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#2ecc71",
          position: "absolute",
          left: "calc(50% - 46px)",
        }} />
        <span>Connected</span>
      </div>
    </>
  );
};

// ── Plugin Registration ──

export default definePlugin(() => {
  return {
    name: "Pixel Buddy",
    titleView: (
      <div className={staticClasses.Title}>
        Pixel Buddy
      </div>
    ),
    content: <Content />,
    icon: <FaHeadphones />,
    onDismount() {},
  };
});
