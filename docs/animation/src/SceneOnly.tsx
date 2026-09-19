import React from "react";
import { AbsoluteFill } from "remotion";
import { beats } from "./timeline";
import { tokensFor } from "./tokens";
import { scenes } from "./scenes";
import storyboard from "../storyboard.json";

// Renders one beat's scene by itself: no neighbours, transitions or loop wrap.
// Used by the per-beat compositions for layout stills.
export type SceneOnlyProps = { target: string; beatId: string };

export const SceneOnly: React.FC<SceneOnlyProps> = ({ target, beatId }) => {
  const beat = beats.find((b) => b.id === beatId);
  const Scene = scenes[beatId];
  if (!beat || !Scene) throw new Error(`no beat/scene for "${beatId}"`);
  const background = storyboard.brand?.background ?? "#0B1020";
  return (
    <AbsoluteFill style={{ backgroundColor: background }}>
      <Scene beat={beat} tokens={tokensFor(target)} />
    </AbsoluteFill>
  );
};
