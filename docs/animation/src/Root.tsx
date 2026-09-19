import React from "react";
import { Composition } from "remotion";
import config from "../animation.config.json";
import { FPS, beats, totalFrames } from "./timeline";
import { tokensFor } from "./tokens";
import { Video } from "./Video";
import { SceneOnly } from "./SceneOnly";

// One composition per delivery target (id = target id, so
// `npx remotion render src/index.ts linkedin-4x5 out.mp4` reads naturally), plus one
// per beat (`<target>--<beatId>`) that renders that scene alone, for layout stills.
// fps and duration come from the storyboard via timeline.ts, never from tokens.
export const RemotionRoot: React.FC = () => (
  <>
    {config.targets.map((target) => {
      const t = tokensFor(target);
      return (
        <React.Fragment key={target}>
          <Composition
            id={target}
            component={Video}
            durationInFrames={totalFrames}
            fps={FPS}
            width={t.width}
            height={t.height}
            defaultProps={{ target }}
          />
          {beats.map((beat) => (
            <Composition
              key={beat.id}
              id={`${target}--${beat.id}`}
              component={SceneOnly}
              durationInFrames={beat.durationInFrames}
              fps={FPS}
              width={t.width}
              height={t.height}
              defaultProps={{ target, beatId: beat.id }}
            />
          ))}
        </React.Fragment>
      );
    })}
  </>
);
