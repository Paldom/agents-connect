// Motion helpers: every value is a pure function of the frame. Numbers come from
// references/motion-vocabulary.md (Material/Carbon easing tokens, BBC reading holds).
import { Easing, interpolate, spring } from "remotion";

export const EASE = {
  standard: Easing.bezier(0.2, 0, 0, 1), // Material 3 standard
  decelerate: Easing.bezier(0, 0, 0, 1), // entrances
  accelerate: Easing.bezier(0.3, 0, 1, 1), // exits
  emphasizedDecelerate: Easing.bezier(0.05, 0.7, 0.1, 1), // hero entrances
  emphasizedAccelerate: Easing.bezier(0.3, 0, 0.8, 0.15), // hero exits
  expressive: Easing.bezier(0.4, 0.14, 0.3, 1), // Carbon expressive standard
} as const;

export const SPRING = {
  text: { damping: 200 }, // no overshoot: text must land, not bounce
  settle: { damping: 18, stiffness: 140 }, // icons and shapes: one small settle
  pop: { damping: 12, stiffness: 180, mass: 0.8 }, // emphasis only, never on text
} as const;

/** Grouped items: 2 frames apart at 30 fps (67 ms), each entering over 9 frames, at
 *  most 4 items, so the whole cascade lands inside 0.5 s (9 + 3 × 2 = 15 frames). */
export const STAGGER_FRAMES = 2;
export const GROUP_ENTER_S = 0.3;
export const MAX_GROUP = 4;

export const clamp01 = (
  frame: number,
  from: number,
  durationInFrames: number,
  easing: (t: number) => number = EASE.decelerate,
): number =>
  interpolate(frame, [from, from + durationInFrames], [0, 1], {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** Entrance progress 0..1 over ENTER (0.4 s), delayed by `delay` frames. */
export const enter = (frame: number, fps: number, delay = 0): number =>
  spring({ frame: frame - delay, fps, config: SPRING.text, durationInFrames: Math.round(0.4 * fps) });

/** Entrance progress for the i-th item of a group (see STAGGER_FRAMES / MAX_GROUP). */
export const enterGroup = (frame: number, fps: number, index: number): number => {
  if (index >= MAX_GROUP) throw new Error(`group of ${index + 1}: split it, max ${MAX_GROUP} items`);
  return spring({
    frame: frame - index * STAGGER_FRAMES,
    fps,
    config: SPRING.text,
    durationInFrames: Math.round(GROUP_ENTER_S * fps),
  });
};

/** Exit progress 0..1 over the last EXIT (0.3 s) frames of a `durationInFrames`-long sequence. */
export const exit = (frame: number, fps: number, durationInFrames: number): number => {
  const exitFrames = Math.round(0.3 * fps);
  return clamp01(frame, durationInFrames - exitFrames, exitFrames, EASE.accelerate);
};

/**
 * Visible = entered and not yet exited; use as opacity for a text card.
 * Pass `skipExit: true` when the beat hands off through an overlapping transition
 * (fade/slide/wipe/morph): the transition is the exit, a second fade would double it.
 */
export const presence = (
  frame: number,
  fps: number,
  durationInFrames: number,
  opts: { skipExit?: boolean; delay?: number } = {},
): number =>
  enter(frame, fps, opts.delay ?? 0) * (opts.skipExit ? 1 : 1 - exit(frame, fps, durationInFrames));

/** Rise-in: fade + short upward travel. Distance in px, typically tokens.type.body. */
export const rise = (p: number, distancePx: number) => ({
  opacity: p,
  transform: `translateY(${((1 - p) * distancePx).toFixed(2)}px)`,
});

/** Scale-in from 0.92, never from 0 (a 0-scale start reads as a glitch). */
export const scaleIn = (p: number) => ({
  opacity: p,
  transform: `scale(${(0.92 + 0.08 * p).toFixed(4)})`,
});

/** Settle for icons: one small overshoot, done within 0.5 s. */
export const settle = (frame: number, fps: number, delay = 0): number =>
  spring({ frame: frame - delay, fps, config: SPRING.settle, durationInFrames: Math.round(0.5 * fps) });

/**
 * Average pan speed at the RED judder guideline (one frame width per 7 s at 24 fps, 180°).
 * A starting point for sharp synthetic frames, not a guarantee; an eased pan peaks at
 * about twice its average, so budget half of this for eased camera moves.
 */
export const maxPanPxPerFrame = (frameWidth: number, fps: number): number => frameWidth / (7 * fps);
