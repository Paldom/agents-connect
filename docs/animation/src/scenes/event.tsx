import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { clamp01, EASE, enter } from "../motion";
import type { SceneProps } from "./Scene";
import { Headline, Pill, Stage, buildC, deployC, hubC, lerp } from "./stage";

// Hook: an event travels build agent → hub → deploy agent. The stage is still for
// the first 20 frames so the loop wrap (18 f) lands on a settled picture.
export const Event: React.FC<SceneProps> = ({ beat, tokens }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = enter(frame, fps, 20); // pill fades in over the build agent
  const t1 = clamp01(frame, 34, 36, EASE.standard); // build → hub (1.2 s)
  const glow = Math.sin(Math.PI * clamp01(frame, 66, 16)); // one pulse at arrival
  const t2 = clamp01(frame, 82, 36, EASE.standard); // hub → deploy
  const pos = t1 < 1 ? lerp(buildC, hubC, t1) : lerp(hubC, deployC, t2);
  const gone = clamp01(frame, 120, 10); // fades out on arrival instead of sitting on the card label
  return (
    <Stage tokens={tokens} phoneLit={false} hubGlow={glow}>
      <Headline text={beat.text} tokens={tokens} frame={frame} fps={fps} />
      <Pill x={pos.x} y={pos.y} channel="#build" body="build 42 green" tokens={tokens} opacity={appear * (1 - gone)} scale={0.92 + 0.08 * appear - 0.04 * gone} />
    </Stage>
  );
};
