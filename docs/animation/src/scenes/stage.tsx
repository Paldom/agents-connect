import React from "react";
import { AbsoluteFill } from "remotion";
import { fontFamily, monoFamily } from "../fonts";
import { enter, rise } from "../motion";
import type { Tokens } from "../tokens";
import storyboard from "../../storyboard.json";

// Shared stage for the three story beats: headline top-left, three nodes in a row
// (build agent · hub · deploy agent), phone top-right. Static geometry lives here so
// every beat draws the same picture; beats add the travelling messages.
export const brand = storyboard.brand;
export const C = {
  bg: brand.background,
  text: brand.text,
  accent: brand.accent,
  muted: brand.muted,
  card: "#2A2C30",
  line: "#3A3D42",
} as const;

export const G = {
  rowY: 405, // vertical centre of the node row
  build: { x: 60, w: 240, y: 330, h: 150 },
  deploy: { x: 900, w: 240, y: 330, h: 150 },
  hub: { cx: 600, cy: 405, r: 70 },
  phone: { x: 920, y: 30, w: 220, h: 290 },
  mail: { cx: 872, cy: 70 },
} as const;
// Pill start/end points sit inboard of the outer cards so a wide pill never leaves the safe area.
export const buildC = { x: G.build.x + G.build.w, y: G.rowY };
export const deployC = { x: G.deploy.x - 60, y: G.rowY };
export const hubC = { x: G.hub.cx, y: G.hub.cy };
export const phoneC = { x: G.phone.x + G.phone.w / 2, y: G.phone.y + G.phone.h / 2 };

// Arc from the hub top to the phone's left edge (the human path).
const arc = { p0: { x: 600, y: 335 }, p1: { x: 700, y: 110 }, p2: { x: 920, y: 175 } };
export const arcPath = `M${arc.p0.x},${arc.p0.y} Q${arc.p1.x},${arc.p1.y} ${arc.p2.x},${arc.p2.y}`;
export const onArc = (t: number) => {
  const u = 1 - t;
  return {
    x: u * u * arc.p0.x + 2 * u * t * arc.p1.x + t * t * arc.p2.x,
    y: u * u * arc.p0.y + 2 * u * t * arc.p1.y + t * t * arc.p2.y,
  };
};
export const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

// Own-work icons (public/icons/*.svg, see assets/manifest.json), inlined so they take currentColor.
const ICONS = {
  hub: (
    <>
      <circle cx="24" cy="24" r="7" />
      <circle cx="24" cy="6" r="3" />
      <circle cx="39.6" cy="33" r="3" />
      <circle cx="8.4" cy="33" r="3" />
      <path d="M24 17V9M29.5 27.5l7.5 4.3M18.5 27.5 11 31.8" />
    </>
  ),
  terminal: (
    <>
      <rect x="4" y="8" width="40" height="32" rx="4" />
      <path d="m12 18 8 6-8 6M24 30h12" />
    </>
  ),
  mail: (
    <>
      <rect x="4" y="10" width="40" height="28" rx="4" />
      <path d="m4 14 20 13 20-13" />
    </>
  ),
  check: <path d="m10 25 9 9 19-20" />,
} as const;

export const Icon: React.FC<{ name: keyof typeof ICONS; size: number; color?: string; stroke?: number; style?: React.CSSProperties }> = ({
  name,
  size,
  color = C.text,
  stroke = 3,
  style,
}) => (
  <svg viewBox="0 0 48 48" width={size} height={size} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {ICONS[name]}
  </svg>
);

export const Headline: React.FC<{ text: string; tokens: Tokens; frame: number; fps: number }> = ({ text, tokens, frame, fps }) => (
  <div
    style={{
      position: "absolute",
      left: tokens.safe.left,
      top: tokens.safe.top,
      maxWidth: 760,
      fontFamily,
      fontSize: tokens.type.body,
      fontWeight: 600,
      lineHeight: tokens.lineHeight,
      color: C.text,
      ...rise(enter(frame, fps), tokens.type.caption),
    }}
  >
    {text}
  </div>
);

const AgentCard: React.FC<{ box: { x: number; y: number; w: number; h: number }; label: React.ReactNode; tokens: Tokens; icon?: React.ReactNode }> = ({ box, label, tokens, icon }) => (
  <div
    style={{
      position: "absolute",
      left: box.x,
      top: box.y,
      width: box.w,
      height: box.h,
      borderRadius: tokens.radius,
      background: C.card,
      border: `${tokens.stroke.min}px solid ${C.line}`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      fontFamily,
      fontSize: tokens.type.caption,
      fontWeight: 500,
      color: C.text,
    }}
  >
    {icon ?? <Icon name="terminal" size={tokens.icon.sm} color={C.muted} />}
    <div style={{ position: "relative", height: tokens.type.caption * tokens.lineHeight, width: box.w }}>{label}</div>
  </div>
);

export const Stage: React.FC<{
  tokens: Tokens;
  phoneLit: boolean;
  showArc?: boolean;
  hubGlow?: number; // 0..1 accent pulse
  deployLabel?: React.ReactNode;
  phoneScreen?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ tokens, phoneLit, showArc, hubGlow = 0, deployLabel, phoneScreen, children }) => {
  const lineW = tokens.stroke.min;
  const glowColor = hubGlow > 0 ? C.accent : C.line;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <svg width={1200} height={600} style={{ position: "absolute", inset: 0 }}>
        <line x1={G.build.x + G.build.w} y1={G.rowY} x2={G.hub.cx - G.hub.r} y2={G.rowY} stroke={C.line} strokeWidth={lineW} />
        <line x1={G.hub.cx + G.hub.r} y1={G.rowY} x2={G.deploy.x} y2={G.rowY} stroke={C.line} strokeWidth={lineW} />
        {showArc ? <path d={arcPath} fill="none" stroke={C.accent} strokeWidth={lineW} strokeDasharray="10 12" opacity={0.7} /> : null}
        <circle cx={G.hub.cx} cy={G.hub.cy} r={G.hub.r + 10 * hubGlow} fill={C.card} stroke={glowColor} strokeWidth={tokens.stroke.regular} opacity={1} />
        {hubGlow > 0 ? <circle cx={G.hub.cx} cy={G.hub.cy} r={G.hub.r + 26 * hubGlow} fill="none" stroke={C.accent} strokeWidth={lineW} opacity={0.6 * (1 - hubGlow)} /> : null}
      </svg>
      <Icon name="hub" size={tokens.icon.md} color={C.accent} style={{ position: "absolute", left: G.hub.cx - tokens.icon.md / 2, top: G.hub.cy - tokens.icon.md / 2 }} />
      <div
        style={{
          position: "absolute",
          left: G.hub.cx - 200,
          top: G.hub.cy + G.hub.r + 6,
          width: 400,
          textAlign: "center",
          fontFamily,
          fontSize: tokens.type.caption,
          fontWeight: 600,
          color: C.accent,
        }}
      >
        agents-connect
      </div>
      <AgentCard box={G.build} label={<CardLabel>build agent</CardLabel>} tokens={tokens} />
      <AgentCard box={G.deploy} label={deployLabel ?? <CardLabel>deploy agent</CardLabel>} tokens={tokens} />
      <Phone tokens={tokens} lit={phoneLit}>{phoneScreen}</Phone>
      {children}
    </AbsoluteFill>
  );
};

export const CardLabel: React.FC<{ children: React.ReactNode; color?: string; opacity?: number }> = ({ children, color = C.text, opacity = 1 }) => (
  <div style={{ position: "absolute", inset: 0, textAlign: "center", color, opacity, whiteSpace: "nowrap" }}>{children}</div>
);

const Phone: React.FC<{ tokens: Tokens; lit: boolean; children?: React.ReactNode }> = ({ tokens, lit, children }) => (
  <div
    style={{
      position: "absolute",
      left: G.phone.x,
      top: G.phone.y,
      width: G.phone.w,
      height: G.phone.h,
      borderRadius: 28,
      border: `${tokens.stroke.regular}px solid ${lit ? C.text : C.line}`,
      background: lit ? "#15161A" : C.card,
      opacity: lit ? 1 : 0.55,
      overflow: "hidden",
      fontFamily,
      color: C.text,
    }}
  >
    <div style={{ position: "absolute", top: 10, left: G.phone.w / 2 - 30, width: 60, height: 6, borderRadius: 3, background: C.line }} />
    {children}
  </div>
);

/** A message pill: channel in muted mono, body in text colour. Centre-anchored. */
export const Pill: React.FC<{ x: number; y: number; channel: string; body: string; tokens: Tokens; accent?: boolean; opacity?: number; scale?: number }> = ({
  x,
  y,
  channel,
  body,
  tokens,
  accent,
  opacity = 1,
  scale = 1,
}) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      transform: `translate(-50%, -50%) scale(${scale.toFixed(4)})`,
      opacity,
      padding: "8px 22px",
      borderRadius: 999,
      background: accent ? C.accent : C.text,
      color: C.bg,
      fontFamily: monoFamily,
      fontSize: tokens.type.caption,
      fontWeight: 500,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
    }}
  >
    <span style={{ opacity: 0.55 }}>{channel}</span>
    <span style={{ opacity: 0.55, margin: "0 10px" }}>·</span>
    {body}
  </div>
);
