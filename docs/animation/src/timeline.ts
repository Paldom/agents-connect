// Frame schedule derived from storyboard.json. Same rounding as the storyboard
// validator (Math.floor(s * fps + 0.5)); never type frame numbers by hand.
import storyboard from "../storyboard.json";

export type TransitionType = "cut" | "fade" | "slide" | "wipe" | "morph" | "none";
export type Role = "hook" | "body" | "cta";
export type Beat = {
  id: string;
  role: Role;
  text: string;
  visual: string;
  motion: string;
  transitionType: TransitionType; // not "transition": Remotion's eslint rule flags that key
  startFrame: number;
  durationInFrames: number;
  overlapInFrames: number;
  overlapOutFrames: number;
};

type RawBeat = {
  id: string;
  role?: string;
  duration_s: number;
  text?: string;
  visual: string;
  motion: string;
  transition?: { type?: string; overlap_s?: number };
};

export const FPS: number = storyboard.fps;
export const LOOP: boolean = Boolean(storyboard.loop);
export const toFrames = (seconds: number): number => Math.floor(seconds * FPS + 0.5);
export const ENTER_FRAMES = toFrames(0.4);
export const EXIT_FRAMES = toFrames(0.3);

const raw = storyboard.beats as RawBeat[];
const overlapOf = (b: RawBeat | undefined): number => toFrames(b?.transition?.overlap_s ?? 0);

let cursor = 0;
export const beats: Beat[] = raw.map((b, i) => {
  const durationInFrames = toFrames(b.duration_s);
  const overlapOutFrames = overlapOf(b);
  const prev = i === 0 ? (LOOP ? raw[raw.length - 1] : undefined) : raw[i - 1];
  const beat: Beat = {
    id: b.id,
    role: (b.role ?? "body") as Role,
    text: b.text ?? "",
    visual: b.visual,
    motion: b.motion,
    transitionType: (b.transition?.type ?? "cut") as TransitionType,
    startFrame: cursor,
    durationInFrames,
    overlapInFrames: overlapOf(prev),
    overlapOutFrames,
  };
  cursor += durationInFrames - overlapOutFrames;
  return beat;
});

/** Total frames = sum of beat frames minus every overlap (the wrap overlap too for loops). */
export const totalFrames = cursor;
