import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The session replay player's page-level wiring, from
 * github.com/OneUptime/oneuptime/issues/3601.
 *
 * SessionReplayPlayer is the one file in the Dashboard allowed to touch
 * rrweb, and it does so behind a dynamic import(); rendering it in a unit
 * test would need a manifest endpoint, an authenticated binary transport and
 * a Replayer. The behaviour it OWNS is nonetheless small and specific, and
 * each item below reverses one of the reported faults, so it is asserted
 * against the source rather than left unpinned:
 *
 *   - playback starts on its own, instead of waiting for a press of Play
 *     that used to do nothing;
 *   - the events rail sits BESIDE the picture and is fed the playhead, so
 *     logs and requests are read together with the recording rather than
 *     found by opening a collapsed panel;
 *   - Play at the end of a recording rewinds first;
 *   - skip-inactive is off.
 *
 * Deliberately structural, not cosmetic: nothing here asserts a colour, a
 * spacing class or a label, so ordinary design work does not break it.
 */

const PLAYER_PATH: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayPlayer.tsx",
);

const SOURCE: string = fs.readFileSync(PLAYER_PATH, "utf8");

const PANEL_PATH: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayDevtoolsPanel.tsx",
);

const PANEL_SOURCE: string = fs.readFileSync(PANEL_PATH, "utf8");

describe("the player starts playing on its own", () => {
  test("it sets isPlaying once a loader and a Replayer factory exist", () => {
    /*
     * Opening a recording is an unambiguous request to watch it. It also
     * removes the whole class of "I pressed Play and nothing happened" from
     * the first thirty seconds of using the feature, because the transport
     * is already proven to be moving by the time anyone reaches for a
     * control.
     */
    expect(SOURCE).toContain("hasAutoPlayedRef");
    expect(SOURCE).toMatch(
      /if \(!loader \|\| !replayerFactory \|\| hasAutoPlayedRef\.current\) \{/,
    );
    expect(SOURCE).toMatch(
      /hasAutoPlayedRef\.current = true;\s*\n\s*setIsPlaying\(true\);/,
    );
  });

  test("it auto-plays at most once, so a viewer who pauses stays paused", () => {
    const guardCount: number = [
      ...SOURCE.matchAll(/hasAutoPlayedRef\.current = true;/g),
    ].length;

    expect(guardCount).toBe(1);
  });
});

describe("the play/pause control", () => {
  test("goes through the shared rewind decision rather than a bare toggle", () => {
    expect(SOURCE).toContain("shouldRewindBeforePlay");
    expect(SOURCE).toContain("onPlayPauseToggle={togglePlayPause}");

    /*
     * The old inline toggle. If it comes back, Play at the end of a
     * recording silently stops doing anything again.
     */
    expect(SOURCE).not.toMatch(
      /onPlayPauseToggle=\{\(\): void => \{\s*\n\s*setIsPlaying\(/,
    );
  });

  test("takes its skip-inactive default from the shared constant", () => {
    /*
     * The constant carries the reasoning and is what the unit test pins;
     * inlining a literal here would let the two drift apart silently.
     */
    expect(SOURCE).toMatch(
      /const \[skipInactive[\s\S]{0,160}?DEFAULT_SKIP_INACTIVE/,
    );
    expect(SOURCE).not.toMatch(/const \[skipInactive[\s\S]{0,160}?\(true\)/);
  });
});

describe("the events rail", () => {
  test("is rendered beside the stage, not under a disclosure", () => {
    /*
     * Both live inside the same flex row, which is what puts the recording
     * and the events people are reading it against on screen together.
     */
    expect(SOURCE).toMatch(/xl:flex-row/);

    const rowStart: number = SOURCE.indexOf("xl:flex-row");
    const stageIndex: number = SOURCE.indexOf("<ReplayStage", rowStart);
    const panelIndex: number = SOURCE.indexOf("<ReplayDevtoolsPanel", rowStart);

    expect(stageIndex).toBeGreaterThan(-1);
    expect(panelIndex).toBeGreaterThan(stageIndex);
  });

  test("is handed the playhead and the transport state", () => {
    const panelStart: number = SOURCE.indexOf("<ReplayDevtoolsPanel");
    const panelProps: string = SOURCE.slice(panelStart, panelStart + 400);

    expect(panelProps).toContain("currentTimeMs={currentTimeMs}");
    expect(panelProps).toContain("isPlaying={isPlaying}");
    expect(panelProps).toContain("onSeek={seekTo}");
  });

  test("has no collapsed-by-default state left in it", () => {
    /*
     * The rail used to open closed, which is what made clicking one of its
     * rows a thing people discovered only while trying to get playback
     * moving.
     */
    expect(PANEL_SOURCE).not.toMatch(
      /useState<boolean>\(false\);?\s*\/\/ ?isOpen/,
    );
    expect(PANEL_SOURCE).not.toContain("aria-expanded");
    expect(PANEL_SOURCE).not.toContain('{isOpen ? "Hide" : "Show"}');
  });
});

describe("the session summary strip", () => {
  test("puts the identifying facts on screen instead of behind the drawer", () => {
    expect(SOURCE).toContain("summaryFacts");

    for (const label of ["User", "Browser", "OS", "Device", "Country"]) {
      expect(SOURCE).toContain(`label: "${label}"`);
    }
  });

  test("drops blank facts rather than rendering an empty row for each", () => {
    expect(SOURCE).toMatch(/return Boolean\(fact\.value\);/);
  });
});
