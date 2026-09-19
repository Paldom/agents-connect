import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { clamp01, EASE, enter, rise, settle } from "../motion";
import type { SceneProps } from "./Scene";
import { C, Headline, Icon, Pill, Stage, deployC, hubC, lerp, onArc, G } from "./stage";
import { fontFamily } from "../fonts";

// The deploy agent asks; the hub pushes the question to the phone (and mail).
export const Ask: React.FC<SceneProps> = ({ beat, tokens }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = enter(frame, fps, 14);
  const t1 = clamp01(frame, 28, 36, EASE.standard); // deploy → hub
  const glow = Math.sin(Math.PI * clamp01(frame, 60, 16));
  const t2 = clamp01(frame, 76, 40, EASE.standard); // hub → phone along the arc
  const pos = t1 < 1 ? lerp(deployC, hubC, t1) : onArc(t2);
  const landed = t2 >= 1;
  const card = enter(frame, fps, 116); // notification card settles on the phone
  const mail = settle(frame, fps, 122);
  return (
    <Stage tokens={tokens} phoneLit={landed || card > 0} showArc hubGlow={glow} phoneScreen={<Notification tokens={tokens} p={card} />}>
      <Headline text={beat.text} tokens={tokens} frame={frame} fps={fps} />
      {!landed ? <Pill x={pos.x} y={pos.y} channel="#deploy" body="Ship v42 to prod?" tokens={tokens} accent opacity={appear} scale={0.92 + 0.08 * appear} /> : null}
      <Icon
        name="mail"
        size={tokens.icon.sm}
        color={C.accent}
        style={{ position: "absolute", left: G.mail.cx - tokens.icon.sm / 2, top: G.mail.cy - tokens.icon.sm / 2, opacity: mail, transform: `scale(${(0.92 + 0.08 * mail).toFixed(4)})` }}
      />
    </Stage>
  );
};

export const Notification: React.FC<{ tokens: import("../tokens").Tokens; p: number; picked?: string; pickP?: number }> = ({ tokens, p, picked, pickP = 0 }) => {
  const chip = (o: string) => {
    const on = picked === o;
    return (
      <div
        key={o}
        style={{
          borderRadius: 999,
          padding: "2px 14px",
          fontSize: tokens.type.caption,
          fontWeight: 500,
          lineHeight: 1.15,
          border: `${tokens.stroke.min}px solid ${on ? C.accent : C.line}`,
          background: on ? C.accent : "transparent",
          color: on ? C.bg : C.text,
          opacity: on ? 1 : 1 - 0.5 * pickP,
          transform: on ? `scale(${(1 + 0.04 * Math.sin(Math.PI * pickP)).toFixed(4)})` : undefined,
        }}
      >
        {o}
      </div>
    );
  };
  return (
    <div style={{ position: "absolute", left: 14, right: 14, top: 28, ...rise(p, 24), display: "flex", flexDirection: "column", gap: 8, fontFamily }}>
      <div style={{ fontSize: tokens.type.caption, fontWeight: 600, lineHeight: tokens.lineHeight, color: C.text }}>
        Ship v42
        <br />
        to prod?
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {chip("yes")}
        {chip("no")}
      </div>
      <div style={{ display: "flex" }}>{chip("later")}</div>
    </div>
  );
};
