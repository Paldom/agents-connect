// Two fonts, loaded once; Video.tsx awaits both behind delayRender().
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const inter = loadInter("normal", { weights: ["500", "600", "700"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["500"], subsets: ["latin"] });

export const fontFamily = inter.fontFamily;
export const monoFamily = mono.fontFamily;
export const waitUntilDone = () => Promise.all([inter.waitUntilDone(), mono.waitUntilDone()]);
