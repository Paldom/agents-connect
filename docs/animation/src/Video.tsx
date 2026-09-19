import React, { useEffect, useState } from "react";
import { AbsoluteFill, Sequence, continueRender, delayRender } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { beats, LOOP, ENTER_FRAMES } from "./timeline";
import { tokensFor } from "./tokens";
import { waitUntilDone } from "./fonts";
import { scenes } from "./scenes";
import storyboard from "../storyboard.json";

// Motion-stage Video: same TransitionSeries as the layout stage, plus the loop wrap.
// Loop semantics: period P = totalFrames; frame P must equal frame 0. The last beat
// cross-fades into a copy of the hook, and the whole series is shifted back by the
// wrap overlap so the cross-fade ends exactly at frame P (= frame 0 of the next pass).

export type VideoProps = { target: string };

const transitionFor = (key: string, type: string, durationInFrames: number) => {
  const timing = linearTiming({ durationInFrames });
  if (type === "slide") {
    return <TransitionSeries.Transition key={key} timing={timing} presentation={slide({ direction: "from-right" })} />;
  }
  if (type === "wipe") {
    return <TransitionSeries.Transition key={key} timing={timing} presentation={wipe({ direction: "from-left" })} />;
  }
  return <TransitionSeries.Transition key={key} timing={timing} presentation={fade()} />;
};

export const Video: React.FC<VideoProps> = ({ target }) => {
  const tokens = tokensFor(target);
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    waitUntilDone().then(() => continueRender(handle));
  }, [handle]);
  const background = storyboard.brand?.background ?? "#0B1020";

  const last = beats[beats.length - 1];
  const wrap = LOOP ? last.overlapOutFrames : 0;
  if (LOOP && wrap < ENTER_FRAMES) {
    throw new Error(
      `loop: the last beat needs a fade transition with overlap >= the hook's entrance ` +
        `(${ENTER_FRAMES} frames, more if the hook staggers); got ${wrap}`,
    );
  }

  const items: React.ReactNode[] = [];
  beats.forEach((beat, i) => {
    const Scene = scenes[beat.id];
    if (!Scene) throw new Error(`no scene component registered for beat "${beat.id}"`);
    items.push(
      <TransitionSeries.Sequence key={beat.id} durationInFrames={beat.durationInFrames}>
        <Scene beat={beat} tokens={tokens} />
      </TransitionSeries.Sequence>,
    );
    const hasNext = i < beats.length - 1;
    if (beat.overlapOutFrames > 0 && hasNext) {
      items.push(transitionFor(`${beat.id}-t`, beat.transitionType, beat.overlapOutFrames));
    } else if (beat.overlapOutFrames > 0 && LOOP) {
      items.push(transitionFor(`${beat.id}-wrap`, "fade", beat.overlapOutFrames)); // the wrap is always a fade
    }
  });
  if (wrap > 0) {
    const Hook = scenes[beats[0].id];
    items.push(
      <TransitionSeries.Sequence key="wrap" durationInFrames={wrap}>
        <Hook beat={beats[0]} tokens={tokens} />
      </TransitionSeries.Sequence>,
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: background }}>
      <Sequence from={-wrap} layout="none">
        <TransitionSeries>{items}</TransitionSeries>
      </Sequence>
    </AbsoluteFill>
  );
};
