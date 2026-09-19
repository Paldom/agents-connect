import React from "react";
import { AbsoluteFill } from "remotion";
import { fontFamily, monoFamily } from "../fonts";
import type { SceneProps } from "./Scene";
import { C, Icon } from "./stage";

// CTA: still for its whole length; the fade transitions carry it in and out.
export const Cta: React.FC<SceneProps> = ({ tokens }) => (
  <AbsoluteFill
    style={{
      backgroundColor: C.bg,
      alignItems: "center",
      justifyContent: "center",
      gap: 22,
      padding: `${tokens.safe.top}px ${tokens.safe.right}px ${tokens.safe.bottom}px ${tokens.safe.left}px`,
      fontFamily,
      color: C.text,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
      <Icon name="hub" size={tokens.icon.md} color={C.accent} />
      <div style={{ fontSize: tokens.type.headline, fontWeight: 700, lineHeight: 1 }}>agents-connect</div>
    </div>
    <div style={{ fontSize: tokens.type.caption, fontWeight: 500, color: C.muted, lineHeight: tokens.lineHeight, textAlign: "center", maxWidth: tokens.safeWidth }}>
      Agents talk to each other, and ask you when it matters.
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6, fontFamily: monoFamily, fontSize: tokens.type.caption, fontWeight: 500, color: C.text }}>
      <div style={{ background: "#15161A", border: `${tokens.stroke.min}px solid ${C.line}`, borderRadius: tokens.radius, padding: "10px 26px" }}>
        <span style={{ color: C.accent }}>$</span> npm i -g agents-connect
      </div>
      <div style={{ background: "#15161A", border: `${tokens.stroke.min}px solid ${C.line}`, borderRadius: tokens.radius, padding: "10px 26px" }}>
        <span style={{ color: C.accent }}>$</span> aconn ask deploy &quot;Ship v42?&quot; --confirm
      </div>
    </div>
  </AbsoluteFill>
);
