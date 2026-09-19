// Map every storyboard beat id to its scene component.
import type React from "react";
import type { SceneProps } from "./Scene";
import { Event } from "./event";
import { Ask } from "./ask";
import { Answer } from "./answer";
import { Cta } from "./cta";

export const scenes: Record<string, React.FC<SceneProps>> = { event: Event, ask: Ask, answer: Answer, cta: Cta };
