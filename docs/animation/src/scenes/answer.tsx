import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { clamp01, EASE, settle } from "../motion";
import type { SceneProps } from "./Scene";
import { C, CardLabel, Headline, Icon, Pill, Stage, deployC, hubC, lerp, onArc } from "./stage";
import { Notification } from "./ask";

// The human taps yes; the answer travels phone → hub → deploy agent, which continues.
export const Answer: React.FC<SceneProps> = ({ beat, tokens }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pick = clamp01(frame, 12, 12); // "yes" chip highlights
  const t1 = clamp01(frame, 28, 40, EASE.standard); // phone → hub (arc, reversed)
  const glow = Math.sin(Math.PI * clamp01(frame, 64, 16));
  const t2 = clamp01(frame, 80, 34, EASE.standard); // hub → deploy
  const pos = t1 < 1 ? onArc(1 - t1) : lerp(hubC, deployC, t2);
  const gone = clamp01(frame, 112, 8); // pill fades out on arrival
  const flying = frame >= 26 && gone < 1;
  const swap = clamp01(frame, 116, 12); // "deploy agent" → "deploying…"
  const done = settle(frame, fps, 136); // check draws in
  const label = (
    <>
      <CardLabel opacity={1 - swap}>deploy agent</CardLabel>
      <CardLabel color={C.accent} opacity={swap * (1 - done)}>deploying…</CardLabel>
      <CardLabel color={C.accent} opacity={done}>
        <Icon name="check" size={tokens.type.caption * 1.2} color={C.accent} stroke={4} style={{ verticalAlign: "middle", marginRight: 8 }} />
        shipped
      </CardLabel>
    </>
  );
  return (
    <Stage tokens={tokens} phoneLit showArc hubGlow={glow} deployLabel={label} phoneScreen={<Notification tokens={tokens} p={1} picked="yes" pickP={pick} />}>
      <Headline text={beat.text} tokens={tokens} frame={frame} fps={fps} />
      {flying ? <Pill x={pos.x} y={pos.y} channel="answer" body="yes" tokens={tokens} accent opacity={1 - gone} /> : null}
    </Stage>
  );
};
