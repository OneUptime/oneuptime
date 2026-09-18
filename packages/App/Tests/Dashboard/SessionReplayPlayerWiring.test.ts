import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The session replay player's page-level wiring, from
 * github.com/OneUptime/oneuptime/issues/3601 and the overhaul design.
 *
 * SessionReplayPlayer is the composition root and the one file in the
 * Dashboard allowed to touch rrweb, behind a dynamic import(); rendering it
 * in a unit test would need a manifest endpoint, an authenticated binary
 * transport and a Replayer. Its siblings (ReplayHeader, ReplayStageOverlays)
 * ARE rendered, in Common/Tests/UI/Rum. What is pinned here is the wiring
 * only this file owns, each item reversing a reported fault:
 *
 *   - rrweb is reachable through exactly one dynamic import, here, and no
 *     other Dashboard file names the package (bundle-size invariant);
 *   - the rrweb download starts BEFORE the manifest resolves, and the first
 *     chunks go on the wire BEFORE the Replayer factory exists (instant feel);
 *   - the engine is read through useSyncExternalStore and disposed with
 *     the component;
 *   - playback starts on its own, exactly once, and rrweb's own skipInactive
 *     is never turned on;
 *   - the live poll carries isRefresh + viewId (one audit row per view) and
 *     no bare manifest request is ever repeated;
 *   - the heartbeat counts time PLAYED and flushes on the way out;
 *   - the rail sits beside the stage and is fed the playhead and selection;
 *   - the header is handed the identity the manifest served;
 *   - the page keys the player on the session, so browser back/forward
 *     between two recordings never reuses one session's state for the next;
 *   - playback carries on into the next browser tab of the session by
 *     itself, through the pure decision rather than rules inlined here,
 *     and a switch made to keep watching resumes rather than landing
 *     paused (github.com/OneUptime/oneuptime/issues/3865).
 *
 * Deliberately structural, not cosmetic: nothing here asserts a colour, a
 * spacing class or a label, so ordinary design work does not break it.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

const PLAYER_PATH: string = path.join(
  DASHBOARD_SRC,
  "Components/SessionReplay/SessionReplayPlayer.tsx",
);

const VIEW_PATH: string = path.join(
  DASHBOARD_SRC,
  "Pages/Rum/View/SessionReplayView.tsx",
);
const STAGE_PATH: string = path.join(
  DASHBOARD_SRC,
  "Components/SessionReplay/ReplayStage.tsx",
);

/*
 * Comments are stripped before searching: the player's header explains why
 * a static `from "rrweb"` would be a disaster, and a naive text search
 * would match the warning and fail on correct code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const SOURCE: string = stripComments(fs.readFileSync(PLAYER_PATH, "utf8"));
const VIEW_SOURCE: string = stripComments(fs.readFileSync(VIEW_PATH, "utf8"));
const STAGE_SOURCE: string = stripComments(fs.readFileSync(STAGE_PATH, "utf8"));

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

/* The text between two markers, so an assertion can be scoped to one region. */
function slice(source: string, fromMarker: string, toMarker: string): string {
  const start: number = source.indexOf(fromMarker);

  expect(start).toBeGreaterThan(-1);

  const end: number = source.indexOf(toMarker, start);

  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe("rrweb boundary", () => {
  test("the player has exactly one dynamic import of rrweb and no static one", () => {
    const dynamicImports: number = (
      SOURCE.match(/import\(\s*["']rrweb["']\s*\)/g) ?? []
    ).length;

    expect(dynamicImports).toBe(1);
    expect(SOURCE).not.toMatch(/from\s+["']rrweb["']/);
    expect(SOURCE).not.toMatch(/require\(\s*["']rrweb["']\s*\)/);
  });

  test("no other Dashboard source names the rrweb package in any form", () => {
    const offenders: Array<string> = [];
    const anyRrwebReference: RegExp = /["']rrweb["']/;

    for (const file of listSourceFiles(DASHBOARD_SRC)) {
      if (file === PLAYER_PATH) {
        continue;
      }

      const source: string = stripComments(fs.readFileSync(file, "utf8"));

      if (anyRrwebReference.test(source)) {
        offenders.push(path.relative(DASHBOARD_SRC, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("instant feel", () => {
  test("the rrweb download starts before the manifest is awaited", () => {
    const importIndex: number = SOURCE.indexOf('import("rrweb")');
    const manifestAwaitIndex: number = SOURCE.indexOf("await manifestPromise");

    expect(importIndex).toBeGreaterThan(-1);
    expect(manifestAwaitIndex).toBeGreaterThan(importIndex);
  });

  test("the first chunks are requested from the manifest handler, before the Replayer factory exists", () => {
    const manifestHandler: string = slice(
      SOURCE,
      "await manifestPromise",
      "await rrwebModulePromise",
    );

    expect(manifestHandler).toContain("loader.loadFirst(");
    expect(manifestHandler).toContain("pendingLoaderRef.current = loader");
    expect(manifestHandler).not.toContain("setReplayerFactory");
  });

  test("the pending loader is reused by the engine rather than fetched twice", () => {
    expect(SOURCE).toMatch(
      /pending && pending\.getTabId\(\) === tab\.tabId \? pending : createLoader\(tab\)/,
    );
  });
});

describe("engine ownership", () => {
  test("the engine is built from the browser deps and read through useSyncExternalStore", () => {
    expect(SOURCE).toContain(
      "createReplayEngine(\n      createBrowserReplayEngineDeps(loader, replayerFactory),",
    );
    expect(SOURCE).toMatch(
      /useSyncExternalStore\(\s*subscribeToEngine,\s*getEngineSnapshot,\s*getEngineSnapshot,\s*\)/,
    );
  });

  test("mobile synthetic events use the same rrweb-compatible engine", () => {
    expect(SOURCE).toContain(
      "createReplayEngine(\n      createBrowserReplayEngineDeps(loader, replayerFactory),",
    );
    expect(SOURCE).not.toMatch(
      /recorderKind[^\n]*(createReplayEngine|createBrowserReplayEngineDeps)/,
    );
  });

  test("the engine is disposed when it is replaced or the player unmounts", () => {
    const disposeEffect: string = slice(
      SOURCE,
      "useEffect(() => {\n    if (!engine) {\n      return;\n    }\n\n    return () => {\n      engine.dispose();",
      "}, [engine]);",
    );

    expect(disposeEffect).toContain("engine.dispose()");
  });

  test("the stage is rendered inside the overlays with the engine, never with the old loader props", () => {
    const stageProps: string = slice(SOURCE, "<ReplayStage\n", "/>");

    expect(stageProps).toContain("engine={engine}");
    expect(stageProps).not.toContain("loader=");
    expect(stageProps).not.toContain("replayerFactory=");
    expect(stageProps).not.toContain("seekRequest=");

    expect(SOURCE.indexOf("<ReplayStageOverlays")).toBeLessThan(
      SOURCE.indexOf("<ReplayStage\n"),
    );
  });
});

/*
 * The redesign's central claim: the recording fills the space the page has
 * instead of being squeezed into whatever is left after a measured
 * reserve. That is a layout fact, and jsdom computes no layout, so the
 * wiring that produces it is pinned here - the shape of the flex chain,
 * the measured fill height, and the absence of the old JavaScript
 * arithmetic that used to size the stage.
 */
describe("the fill layout", () => {
  test("the root gets a measured fill height at xl and the class that consumes it", () => {
    expect(SOURCE).toContain("useReplayFillHeight(rootRef, !isTheater)");
    expect(SOURCE).toContain("REPLAY_FILL_HEIGHT_CSS_VAR");

    /* The variable is only set once a measurement exists; otherwise the rule falls back to auto. */
    expect(SOURCE).toMatch(
      /fillHeightPx === null\s*\?\s*\{\}\s*:\s*\{ \[REPLAY_FILL_HEIGHT_CSS_VAR\]: `\$\{fillHeightPx\}px` \}/,
    );
    expect(SOURCE).toMatch(
      /const REPLAY_ROOT_FLOW_CLASS: string =\s*"[^"]*xl:h-\[var\(--oneuptime-replay-fill-height\)\][^"]*"/,
    );

    const root: string = slice(
      SOURCE,
      'data-testid="replay-player"',
      "<ReplayHeaderClocked",
    );

    expect(root).toContain("style={fillHeightStyle}");
    expect(root).toContain("data-replay-sizing={stageSizing}");
    expect(root).toMatch(
      /className=\{\s*isTheater \? REPLAY_ROOT_FILL_CLASS : REPLAY_ROOT_FLOW_CLASS\s*\}/,
    );
  });

  test("theater sizes the same chain at every width, inline only from xl up", () => {
    expect(SOURCE).toContain(
      'const stageSizing: ReplayStageSizing = isTheater ? "fill" : "responsive";',
    );

    /* Flow rules unprefixed, fill rules behind xl: - one string, no breakpoint check in JS. */
    for (const [name, required] of [
      [
        "REPLAY_MAIN_ROW_FLOW_CLASS",
        ["xl:min-h-0", "xl:flex-1", "xl:flex-row"],
      ],
      ["REPLAY_PLAYER_COLUMN_FLOW_CLASS", ["flex-1", "xl:min-h-0"]],
      ["REPLAY_CARD_FLOW_CLASS", ["flex flex-col", "xl:min-h-0", "xl:flex-1"]],
      ["REPLAY_MAIN_ROW_FILL_CLASS", ["min-h-0", "flex-1"]],
      ["REPLAY_PLAYER_COLUMN_FILL_CLASS", ["min-h-0", "flex-1"]],
      ["REPLAY_CARD_FILL_CLASS", ["min-h-0", "flex-1"]],
    ] as Array<[string, Array<string>]>) {
      const declaration: string = slice(SOURCE, `const ${name}: string =`, ";");

      for (const fragment of required) {
        expect(declaration).toContain(fragment);
      }
    }

    /* The card is never clipped: the speed menu and the More menu leave it. */
    expect(SOURCE).not.toMatch(
      /const REPLAY_CARD_(FLOW|FILL)_CLASS: string =\s*"[^"]*overflow-hidden/,
    );
  });

  test("the stage is told how it is sized and how it is fitted, and measures nothing itself", () => {
    const stageProps: string = slice(SOURCE, "<ReplayStage\n", "/>");

    expect(stageProps).toContain("sizing={stageSizing}");
    expect(stageProps).toContain("fit={prefs.stageFit}");
    /* The stage owns its own box now; the shell no longer reserves height for the transport. */
    expect(stageProps).not.toContain("reservedBottomHeightPx");
    expect(stageProps).not.toContain("isTheater=");
    expect(SOURCE).not.toContain("reservedBottomHeightPx");
    expect(SOURCE).not.toContain("scrubberHeightPx");
    expect(SOURCE).not.toContain("scrubberContainerRef");

    const overlayProps: string = slice(
      SOURCE,
      "<ReplayStageOverlaysClocked",
      "children: (",
    );

    expect(overlayProps).toContain("sizing: stageSizing");
  });

  test("the transport keeps its height and the stage takes the rest", () => {
    expect(SOURCE).toContain(
      '<div className="shrink-0 border-t border-gray-200">',
    );
  });

  test("the engine placeholder reserves exactly the stage's box", () => {
    const placeholder: string = slice(
      SOURCE,
      "{isPlayable && !engine && (",
      'data-testid="replay-stage-placeholder"',
    );

    expect(placeholder).toContain("getReplayStageBoxClassName(");
    expect(placeholder).toContain("stageSizing");
    expect(placeholder).toContain("prefs.stageFit");
    expect(placeholder).toContain("REPLAY_STAGE_ASPECT_CSS_VAR");
    expect(placeholder).toContain("formatReplayStageAspect(recordedSize)");
    /* The hard-coded box the placeholder used to draw, which the real stage never matched. */
    expect(placeholder).not.toContain("aspectRatio:");
    expect(placeholder).not.toContain('minHeight: "24rem"');
    expect(placeholder).not.toContain('maxHeight: "70vh"');
  });

  test("the loading skeleton lays out like the player it becomes", () => {
    const loading: string = slice(
      SOURCE,
      'data-testid="replay-loading"',
      "<ReplayRail\n",
    );

    /* The same ref, so the fill height is measured before the manifest lands. */
    expect(SOURCE).toMatch(/ref=\{rootRef\}\s*data-testid="replay-loading"/);
    expect(loading).toContain("style={fillHeightStyle}");
    expect(loading).toContain("className={REPLAY_ROOT_FLOW_CLASS}");
    expect(loading).toContain("className={REPLAY_MAIN_ROW_FLOW_CLASS}");
    expect(loading).toContain("className={REPLAY_PLAYER_COLUMN_FLOW_CLASS}");
    expect(loading).toContain("className={REPLAY_CARD_FLOW_CLASS}");
    expect(loading).toContain("getReplayStageBoxClassName(");
    /* No detail card above the picture any more, in either state. */
    expect(SOURCE).not.toContain('<Card title="Session recording">');
  });

  /*
   * ...including at the width the viewer actually dragged the rail to.
   * The rail width is a stored preference applied as a CSS variable on the
   * main row. The skeleton used to leave it to the class default, so a
   * viewer who had widened their rail watched the stage jump sideways the
   * instant the manifest landed - the one layout shift the skeleton exists
   * to prevent.
   */
  test("the skeleton's main row carries the viewer's stored rail width", () => {
    const declaration: number = SOURCE.indexOf("const railWidthStyle:");
    const skeleton: number = SOURCE.indexOf('data-testid="replay-loading"');

    expect(declaration).toBeGreaterThan(-1);
    expect(skeleton).toBeGreaterThan(-1);
    /* Read BEFORE the loading branch, or the skeleton cannot apply it. */
    expect(declaration).toBeLessThan(skeleton);

    /* And the manifest guard is what sits between the two. */
    expect(SOURCE.slice(declaration, skeleton)).toContain("if (!manifest) {");

    expect(SOURCE).toContain(
      '"--oneuptime-replay-rail-width": `${prefs.railWidthRem}rem`',
    );
    expect(SOURCE).toMatch(
      /prefs\.railCollapsed\s*\?\s*\{\}\s*:\s*\{\s*"--oneuptime-replay-rail-width"/,
    );

    const loading: string = slice(
      SOURCE,
      'data-testid="replay-loading"',
      "<ReplayRail\n",
    );

    expect(loading).toContain(
      "className={REPLAY_MAIN_ROW_FLOW_CLASS} style={railWidthStyle}",
    );

    /*
     * One constant, applied to the skeleton's row and the real player's -
     * two copies of the expression is how the two drift apart again.
     */
    expect(SOURCE.match(/style=\{railWidthStyle\}/g)).toHaveLength(2);
  });

  /*
   * The other half of the same rule: a stored width only avoids the jump
   * for a viewer who HAS a rail. One who keeps it collapsed had a 26rem
   * column reserved in the skeleton and watched the stage grow into it
   * when the manifest landed.
   */
  test("the skeleton drops the rail column when the viewer keeps it collapsed", () => {
    const loading: string = slice(
      SOURCE,
      'data-testid="replay-loading"',
      "<ReplayRail\n",
    );

    expect(loading).toContain("REPLAY_RAIL_COLUMN_CLASS");
    expect(loading).toMatch(/prefs\.railCollapsed\s*\?\s*"hidden"\s*:\s*""/);
  });

  test("how the picture is fitted is a preference, cycled by the keyboard", () => {
    expect(SOURCE).toContain("fit: prefs.stageFit");
    expect(SOURCE).toContain("onFitChange: changeFit");
    expect(SOURCE).toContain("replayViewPrefsStore.update({ stageFit: fit })");
    expect(SOURCE).toContain("cycleReplayStageFit(");
    /* It used to reset to "contain" on every navigation between sessions. */
    expect(SOURCE).not.toContain("useState<ReplayStageFit>");
  });

  /*
   * The scrubber owns the keyboard listener (it is the only component
   * mounted whenever there is footage), so every new player-level action
   * reaches the shell as one of its props. Without these four the "r" and
   * "z" keys and the More menu's lanes item resolve to no-ops.
   */
  test("the scrubber carries the rail toggle, the fit cycle and the lanes preference", () => {
    const scrubberProps: string = slice(SOURCE, "<ReplayScrubber\n", "/>");

    expect(scrubberProps).toContain("showTimelineLanes={prefs.timelineLanes}");
    expect(scrubberProps).toContain(
      "onTimelineLanesChange={changeTimelineLanes}",
    );
    expect(scrubberProps).toContain("onToggleRail={toggleRailCollapsed}");
    expect(scrubberProps).toContain("onCycleFit={cycleFit}");
    expect(SOURCE).toContain(
      "replayViewPrefsStore.update({ timelineLanes: isVisible })",
    );
  });
});

describe("playback intent", () => {
  test("auto-plays exactly once, right after the initial LOAD", () => {
    const autoPlays: number = (
      SOURCE.match(/created\.dispatch\(\{ type: "PLAY" \}\)/g) ?? []
    ).length;

    expect(autoPlays).toBe(1);
    expect(SOURCE.indexOf('type: "LOAD"')).toBeLessThan(
      SOURCE.indexOf('created.dispatch({ type: "PLAY" })'),
    );
  });

  test("never passes skipInactive: true to the engine or a Replayer", () => {
    expect(SOURCE).not.toMatch(/skipInactive:\s*true/);
    expect(SOURCE).not.toMatch(/initialSkipInactive:\s*true/);
    expect(SOURCE).toContain("initialSkipInactive: prefs.skipIdle");
  });

  test("play/pause and every seek go through the engine, not local state", () => {
    expect(SOURCE).not.toContain("setIsPlaying(");
    expect(SOURCE).not.toContain("setCurrentTimeMs(");
    expect(SOURCE).toMatch(
      /current\.getSnapshot\(\)\.intent === "playing" \? "PAUSE" : "PLAY"/,
    );
    expect(SOURCE).toMatch(
      /type: "SEEK",\s*offsetMs: Math\.max\(0, offsetMs\),/,
    );
  });

  test("a tab switch dispatches TAB_SWITCH with a fresh loader so the playhead is preserved", () => {
    expect(SOURCE).toMatch(
      /type: "TAB_SWITCH",\s*tabId: tabId,\s*loader: loader,/,
    );
  });
});

/*
 * Continuous playback across the browser tabs of one recording
 * (github.com/OneUptime/oneuptime/issues/3865). The recorder mints a tab
 * id per page load, so a four-page visit is four tabs; playback stopped at
 * each one for a click on "Continue in Tab N" and another on Play.
 *
 * The rules for when to move a viewer on live in ReplayAutoContinue and
 * are tested there. What only this file can own is the wiring: that the
 * decision is the single gate, that the shell does not re-derive it, that
 * the hop is recorded before it is made (the loop guard), and that the
 * two kinds of tab switch are kept apart.
 */
describe("continuous playback across tabs", () => {
  test("the decision is taken by the pure module, not re-derived in the shell", () => {
    expect(SOURCE).toContain("decideReplayAutoContinue({");
    expect(SOURCE).toContain("isEnabled: prefs.autoContinue,");
    expect(SOURCE).toContain("nextTab: continueInTab,");
    expect(SOURCE).toContain(
      "enteredTabIds: autoContinueRef.current.getEnteredTabIds(),",
    );
    expect(SOURCE).toContain("hopCount: autoContinueRef.current.getHopCount()");
  });

  test("nothing happens unless the decision says so", () => {
    const effect: string = slice(
      SOURCE,
      "const decision: ReplayAutoContinueDecision",
      "continueInTabById(decision.tabId);",
    );

    expect(effect).toContain(
      "if (!decision.shouldContinue || !decision.tabId || !continueInTab) {",
    );
    expect(effect).toContain("return;");
    /*
     * The shell must not second-guess the decision with a rule of its
     * own: a phase check, a liveness check or a tab-count check here
     * would be a second copy of the policy, tested nowhere.
     */
    expect(effect).not.toMatch(/snapshot\.phase\s*===/);
    expect(effect).not.toContain("isLive");
  });

  /*
   * "Did playback run out, or did the viewer stop here?" - latched on the
   * transition, held while the engine stays at "ended" so a live
   * recording can still continue once a later poll reveals the tab the
   * user navigated to.
   */
  test("the played-out latch is set on the transition and cleared off it", () => {
    const effect: string = slice(
      SOURCE,
      "const previousPhase: ReplayPhase | null = previousPhaseRef.current;",
      "const decision: ReplayAutoContinueDecision",
    );

    expect(effect).toContain("previousPhaseRef.current = snapshot.phase;");
    expect(effect).toContain('if (snapshot.phase !== "ended") {');
    expect(effect).toContain("didPlayOutRef.current = false;");
    expect(effect).toContain(
      "didPlayOutRef.current = isReplayPlaybackPhase(previousPhase);",
    );
  });

  /*
   * The loop guard only works if the hop is recorded BEFORE the switch:
   * the effect runs again on the publishes the switch itself causes, and
   * a hop recorded afterwards would let the same target through twice.
   */
  test("the hop is recorded before the switch is made", () => {
    const handler: string = slice(
      SOURCE,
      "const continueInTabById:",
      "const toggleTheater:",
    );

    expect(handler).toContain("autoContinueRef.current.noteEntered(tabId);");
    expect(handler).toContain("switchTabTo(tabId, true);");
    expect(handler.indexOf("noteEntered")).toBeLessThan(
      handler.indexOf("switchTabTo"),
    );
  });

  /*
   * Two kinds of switch, and the difference is the whole second half of
   * the bug: continuing resumes, picking a tab keeps the intent in force.
   */
  test("continuing resumes playback; picking a tab does not", () => {
    expect(SOURCE).toMatch(/resume:\s*resume,/);

    const manual: string = slice(
      SOURCE,
      "const switchTab: (tabId: string) => void",
      "const continueInTabById:",
    );

    expect(manual).toContain("switchTabTo(tabId, false);");
    /* A tab the viewer picked hands the wheel back to them. */
    expect(manual).toContain("autoContinueRef.current.reset();");
  });

  test("the switch is told why, and the engine is the only thing that acts", () => {
    expect(SOURCE).toContain(
      "const switchTabTo: (tabId: string, resume: boolean) => void",
    );
    /* No second PLAY dispatch chasing the switch: the engine lands playing. */
    const effect: string = slice(
      SOURCE,
      "const decision: ReplayAutoContinueDecision",
      "}, [snapshot.phase, prefs.autoContinue",
    );

    expect(effect).not.toContain('type: "PLAY"');
  });

  test("the viewer is told which tab the recording carried on in", () => {
    expect(SOURCE).toContain(
      "setShellNotice(describeReplayAutoContinue(continueInTab));",
    );
  });

  /* Both Continue chips get the resuming handler, not the plain switch. */
  test("the header chip and the ended card both continue rather than switch", () => {
    expect(SOURCE).toContain("onContinueInTab: continueInTabById,");
    expect(
      (SOURCE.match(/onContinueInTab: continueInTabById,/g) ?? []).length,
    ).toBe(2);
  });

  test("the preference is offered in the transport and persisted", () => {
    expect(SOURCE).toContain("isAutoContinueEnabled={prefs.autoContinue}");
    expect(SOURCE).toContain("onAutoContinueChange={changeAutoContinue}");
    expect(SOURCE).toContain(
      "replayViewPrefsStore.update({ autoContinue: isEnabled });",
    );
  });

  /*
   * Turning it back on mid-session must do something on the next end of
   * a tab, not wait for a tab the walk has not already consumed.
   */
  test("turning it back on clears what the walk remembered", () => {
    const handler: string = slice(
      SOURCE,
      "const changeAutoContinue:",
      "if (manifestFailure) {",
    );

    expect(handler).toContain("if (isEnabled) {");
    expect(handler).toContain("autoContinueRef.current.reset();");
  });
});

describe("read-only text selection", () => {
  test("enabling selection pauses before exposing the replay document", () => {
    const handler: string = slice(
      SOURCE,
      "const changeTextSelection:",
      "const retry:",
    );
    const pauseIndex: number = handler.indexOf(
      'engineRef.current?.dispatch({ type: "PAUSE" })',
    );
    const enableIndex: number = handler.indexOf(
      "setIsTextSelectionEnabled(isEnabled)",
    );

    expect(pauseIndex).toBeGreaterThan(-1);
    expect(enableIndex).toBeGreaterThan(pauseIndex);
  });

  test("playback and seeks wait for the replay document to leave selection mode", () => {
    const exitCoordinator: string = slice(
      SOURCE,
      "const runAfterTextSelectionExit:",
      "const dispatchSeek:",
    );
    const seekHandler: string = slice(
      SOURCE,
      "const seekTo:",
      "const playPause:",
    );
    const playPauseHandler: string = slice(
      SOURCE,
      "const playPause:",
      "const watchAgain:",
    );
    const watchAgainHandler: string = slice(
      SOURCE,
      "const watchAgain:",
      "const changeTextSelection:",
    );

    expect(exitCoordinator).toContain(
      "pendingTextSelectionActionRef.current = action",
    );
    expect(exitCoordinator).toContain("setIsTextSelectionEnabled(false)");
    expect(seekHandler).toContain("runAfterTextSelectionExit((): void =>");
    expect(seekHandler).toContain("dispatchSeek(offsetMs)");
    expect(playPauseHandler).toContain("runAfterTextSelectionExit((): void =>");
    expect(watchAgainHandler).toContain(
      "runAfterTextSelectionExit((): void =>",
    );
    expect(STAGE_SOURCE).toMatch(
      /useLayoutEffect\(\(\) => \{\s*for \(const replayer of replayersRef\.current\)/,
    );
  });

  test("the same selection state is wired to the toolbar and replay stage", () => {
    expect(SOURCE).toContain("isTextSelectionEnabled: isTextSelectionEnabled");
    expect(SOURCE).toContain("onTextSelectionChange: changeTextSelection");
    expect(SOURCE).toContain(
      "isPlayable && engine !== null && isReplayDocumentReady",
    );

    const stageProps: string = slice(SOURCE, "<ReplayStage\n", "/>");
    expect(stageProps).toContain(
      "isTextSelectionEnabled={isTextSelectionEnabled}",
    );
  });

  test("a session or engine reload cannot carry selection into autoplay", () => {
    const manifestReset: string = slice(
      SOURCE,
      "setManifest(null);",
      "const rrwebModulePromise:",
    );

    expect(manifestReset).toContain("setEngine(null)");
    expect(manifestReset).toContain("setIsTextSelectionEnabled(false)");
    expect(manifestReset).toContain("setIsReplayDocumentReady(false)");
  });

  test("the toggle becomes available only while a real replay document exists", () => {
    const replayerLifecycle: string = slice(
      SOURCE,
      "return engine.onReplayer((event: ReplayEngineReplayerEvent): void =>",
      "const store: ReplayBackendSignalsStore",
    );

    expect(SOURCE).toContain(
      "const [isReplayDocumentReady, setIsReplayDocumentReady]",
    );
    expect(replayerLifecycle).toContain('event.type === "created"');
    expect(replayerLifecycle).toContain(
      'event.type === "fullsnapshot-rebuilded"',
    );
    expect(replayerLifecycle).toContain(
      "event.replayer.iframe.contentDocument",
    );
    expect(replayerLifecycle).toContain("setIsReplayDocumentReady(false)");
    expect(replayerLifecycle).toContain("setIsTextSelectionEnabled(false)");
  });
});

describe("live sessions", () => {
  test("the poll re-fetches the manifest with isRefresh and the existing viewId", () => {
    const pollEffect: string = slice(
      SOURCE,
      "const poll: () => Promise<void>",
      "}, [\n    isAwaitingFinalization,\n    viewId,",
    );

    expect(pollEffect).toContain("refresh: { viewId: viewId }");
    expect(pollEffect).toContain('type: "APPEND_ENTRIES"');
    expect(pollEffect).toContain("setInterval(");
    expect(pollEffect).toContain("LIVE_MANIFEST_POLL_MS");
  });

  test("a refresh request always carries isRefresh: true alongside the viewId", () => {
    const transport: string = slice(
      SOURCE,
      "async function fetchManifest",
      "return parseManifest",
    );

    expect(transport).toMatch(
      /body\["isRefresh"\] = true;\s*body\["viewId"\] = args\.refresh\.viewId;/,
    );
  });

  test("only the initial load makes an audit-writing manifest request", () => {
    /*
     * Exactly one call omits `refresh`. That call carries the access
     * reason (ux-12); every other one names the existing view so the
     * server reuses its audit row.
     */
    const calls: Array<string> =
      SOURCE.match(/fetchManifest\(\{[\s\S]*?\n {4}\}\)/g) ?? [];
    const auditWriting: Array<string> = calls.filter(
      (call: string): boolean => {
        return !call.includes("refresh:");
      },
    );

    expect(calls.length).toBeGreaterThan(1);
    expect(auditWriting).toHaveLength(1);
    expect(auditWriting[0]).toContain("accessReason:");
  });

  /*
   * github.com/OneUptime/oneuptime/issues/3642 split one flag in two. The
   * poll keeps running until the finalized header lands - an ended
   * session's counts only arrive through it - while "live" (the pill, the
   * caught-up overlay) goes out as soon as every tab has closed.
   */
  test("polling is gated on the session not being finalized, not on it being live", () => {
    expect(SOURCE).toMatch(
      /const isAwaitingFinalization: boolean =\s*manifest !== null && isManifestAwaitingFinalization\(manifest\);/,
    );
    expect(SOURCE).toMatch(/if \(!isAwaitingFinalization\) \{\s*return;\s*\}/);
    expect(SOURCE).not.toMatch(/if \(!isLive\) \{\s*return;\s*\}/);
  });

  test("live means not finalized AND not every tab has ended", () => {
    expect(SOURCE).toMatch(
      /const isLive: boolean =\s*manifest !== null && isManifestRecordingLive\(manifest\);/,
    );
    /* The old definition read every unfinalized session as live. */
    expect(SOURCE).not.toContain(
      "const isLive: boolean = manifest !== null && !manifest.isFinalized;",
    );
  });

  test("each refresh replaces the manifest, so hasRecordingEnded follows the server", () => {
    const pollEffect: string = slice(
      SOURCE,
      "const poll: () => Promise<void>",
      "}, [\n    isAwaitingFinalization,\n    viewId,",
    );

    expect(pollEffect).toMatch(/\.\.\.refreshed,/);
  });

  test("the stage overlays, the root attribute and the header all read the live flag", () => {
    expect(SOURCE).toContain('data-replay-live={isLive ? "true" : "false"}');
    expect(SOURCE).toMatch(/sealedReason: sealedReason,\s*isLive: isLive,/);
  });

  test("the details panel is told when every tab has ended", () => {
    const panel: string = slice(SOURCE, "<ReplayCorrelationPanel\n", "/>");

    expect(panel).toContain("hasRecordingEnded={manifest.hasRecordingEnded}");
  });

  /*
   * A fullscreen element puts itself in the browser's top layer and
   * nothing outside it is painted, so the details panel - a fixed overlay
   * rendered as the root's SIBLING - was invisible in theater mode: "i"
   * and the "Session details" button appeared to do nothing. Nesting is
   * only visible in the source as indentation, so that is what is pinned.
   */
  test("the details panel is rendered inside the player root, so theater mode shows it", () => {
    const rootIndex: number = SOURCE.indexOf('data-testid="replay-player"');
    const panelIndex: number = SOURCE.indexOf("<ReplayCorrelationPanel\n");
    const offsetTextIndex: number = SOURCE.indexOf("<ReplayOffsetText clock=");

    expect(panelIndex).toBeGreaterThan(rootIndex);
    expect(offsetTextIndex).toBeGreaterThan(panelIndex);

    /* One level in from the root element, which the Fragment indents by six. */
    expect(SOURCE).toContain("\n        <ReplayCorrelationPanel\n");
    expect(SOURCE).not.toContain("\n      <ReplayCorrelationPanel\n");
  });

  test("the sealed reason is quoted once the recording has ended, not while it is live", () => {
    expect(SOURCE).toContain(
      "manifest && (manifest.isFinalized || manifest.hasRecordingEnded)",
    );
  });
});

describe("watch-time heartbeat", () => {
  const heartbeat: string = slice(
    SOURCE,
    "let watchedMs: number = 0;",
    "}, [engine, viewId]);",
  );

  test("accumulates only while the engine phase is playing, scaled by speed", () => {
    expect(heartbeat).toMatch(
      /if \(current\.phase === "playing"\) \{\s*watchedMs \+= Math\.max\(0, now - lastSampleAt\) \* current\.speed;/,
    );
    expect(SOURCE).not.toContain("Math.max(watchedMsRef.current, offsetMs)");
  });

  test("flushes on pagehide, on hide and on unmount with keepalive", () => {
    expect(heartbeat).toContain(
      'window.addEventListener("pagehide", onPageHide)',
    );
    expect(heartbeat).toContain(
      'document.addEventListener("visibilitychange", onVisibilityChange)',
    );
    expect(heartbeat).toMatch(/return \(\) => \{[\s\S]*send\(true\);\s*\};/);
    expect(SOURCE).toContain("keepalive: keepalive");
  });

  test("never sends the same figure twice", () => {
    expect(heartbeat).toContain("seconds === lastSentSeconds");
  });
});

describe("the events rail", () => {
  test("is rendered beside the stage column inside the same flex row", () => {
    /*
     * The row is the element that carries the rail's width variable and
     * the main-row classes; both columns are inside it, player first.
     */
    const row: string = slice(
      SOURCE,
      "isTheater ? REPLAY_MAIN_ROW_FILL_CLASS : REPLAY_MAIN_ROW_FLOW_CLASS",
      'data-testid="replay-rail-column"',
    );

    expect(row).toContain("style={railWidthStyle}");
    expect(row).toContain("<ReplayStageOverlaysClocked");
    expect(SOURCE.indexOf("<ReplayRail\n")).toBeGreaterThan(-1);
  });

  test("is handed the playhead, the transport state, the selection and the seek", () => {
    const railProps: string = slice(
      SOURCE,
      "<ReplayRailClocked\n      clock={engine}",
      "/>",
    );

    /*
     * The playhead no longer rides in on a prop from this component. The
     * rail subscribes to the engine's clock channel through the wrapper,
     * at a quantum this component chooses, so the ~30Hz publish stops
     * re-rendering an 1800-line list for a readout that shows seconds.
     */
    expect(railProps).not.toContain("currentTimeMs:");
    expect(railProps).toContain("quantumMs={");
    expect(railProps).toContain("REPLAY_RAIL_CLOCK_MS");
    expect(railProps).toContain("railRef={railRef}");
    expect(railProps).toContain('isPlaying: snapshot.phase === "playing"');
    expect(railProps).toContain("selectedSignalId: selectedSignalId");
    expect(railProps).toContain("onSeek: seekTo");
    expect(railProps).toContain("backendStore: backendStore");
    expect(railProps).toContain("isExpiredFootage: !isPlayable");
    expect(railProps).toContain("onTelemetrySignalsChange:");
  });

  test("the rail is given the exact playhead while paused and a coarse one while playing", () => {
    /*
     * The rail's "now" divider shows tenths of a second when the picture
     * is still, and there is no frame budget to protect then; while
     * playing it is quantised so the list re-renders four times a second
     * instead of thirty.
     */
    const railProps: string = slice(
      SOURCE,
      "<ReplayRailClocked\n      clock={engine}",
      "/>",
    );

    expect(railProps).toMatch(
      /quantumMs=\{\s*snapshot\.phase === "playing"\s*\?\s*REPLAY_RAIL_CLOCK_MS\s*:\s*REPLAY_CLOCK_EXACT_MS\s*\}/,
    );
  });

  test("stays mounted in the no-footage mode so telemetry still loads", () => {
    /* The rail element is built once and rendered regardless of isPlayable. */
    expect(SOURCE).toContain("const railElement: ReactElement = (");
    expect(SOURCE).toMatch(/\{railElement\}/);
  });

  /*
   * ux-02: outside theater nothing bounded the rail's height, so its list
   * never overflowed - follow, the now-divider anchoring, "Jump to now"
   * and the >500-row windowing were all inert and a long session made the
   * page tens of thousands of pixels tall. The bound is a layout fact, so
   * it is pinned as one: jsdom computes no layout, and an E2E run at a
   * real viewport is the only other way to see it.
   */
  test("the rail column has a bounded height so the rail's list can scroll", () => {
    const columnClass: string = slice(
      SOURCE,
      "const REPLAY_RAIL_COLUMN_CLASS: string =",
      ";",
    );

    /* Stacked below xl the cap IS the bound... */
    expect(columnClass).toMatch(/max-h-\[\d+rem\]/);
    expect(columnClass).toContain("min-h-0");
    /*
     * ...and beside the player the row has a definite height of its own
     * (the fill height), so the cap comes off and the column stretches to
     * the picture instead of to a guess at the viewport.
     */
    expect(columnClass).toContain("xl:max-h-none");
    expect(columnClass).not.toMatch(/xl:max-h-\[calc\(100vh-[^\]]+\)\]/);

    const column: string = slice(
      SOURCE,
      'data-testid="replay-rail-column"',
      "replay-rail-resize-handle",
    );

    expect(column).toContain("REPLAY_RAIL_COLUMN_CLASS");
  });

  test("the rail's own width preference drives the column, at the pref's default", () => {
    expect(SOURCE).toMatch(
      /const REPLAY_RAIL_COLUMN_WIDTH_CLASS: string =\s*"xl:w-\[var\(--oneuptime-replay-rail-width,26rem\)\]"/,
    );
    expect(SOURCE).toContain(
      '"--oneuptime-replay-rail-width": `${prefs.railWidthRem}rem`',
    );
    /* The 30rem default the rail used to claim is gone from the fallback. */
    expect(SOURCE).not.toContain("--oneuptime-replay-rail-width,30rem");
  });

  /*
   * The "r" shortcut collapses the rail at every width, so the collapsed
   * state and the way back out of it have to exist at every width too -
   * the affordance used to be xl-only, which left a narrow viewer with a
   * key that hid nothing and a button they could not reach.
   */
  test("collapsing the rail applies at every width, and so does the way back", () => {
    const column: string = slice(
      SOURCE,
      'data-testid="replay-rail-column"',
      "{railElement}",
    );

    expect(column).toMatch(/prefs\.railCollapsed \? "hidden" : ""/);
    expect(column).not.toContain('"xl:hidden"');

    const expandButton: string = slice(
      SOURCE,
      'data-testid="replay-rail-expand"',
      "</button>",
    );

    expect(expandButton).toContain("onClick={toggleRailCollapsed}");
    expect(expandButton).not.toContain("hidden");
    expect(expandButton).not.toContain("xl:flex");
  });

  test("nothing between the rail column and the rail re-introduces content height", () => {
    /*
     * The chain has to be able to shrink the whole way down, and the rail
     * itself must take the remaining height rather than its own content
     * height (`h-full` resolved to the latter, which was the bug).
     */
    const railProps: string = slice(
      SOURCE,
      "<ReplayRailClocked\n      clock={engine}",
      "/>",
    );

    expect(railProps).toContain('className: "min-h-0 flex-1"');
    expect(railProps).not.toContain('className: "h-full"');
    expect(SOURCE).toContain(
      "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
    );
  });

  test("the keyboard map's rail keys reach the rail's handle", () => {
    for (const method of [
      "stepSignal(1)",
      "stepSignal(-1)",
      "focusSearch()",
      "moveSelection(1)",
      "moveSelection(-1)",
      "seekSelected()",
      "clearSelection()",
      "revealSignal(",
    ]) {
      expect(SOURCE).toContain(`railRef.current?.${method}`);
    }
  });
});

describe("the header", () => {
  test("receives the identity the manifest served (null when not permitted)", () => {
    const headerProps: string = slice(SOURCE, "<ReplayHeaderClocked\n", "/>");

    expect(headerProps).toContain(
      "label: manifest.details.identifiedUserLabel",
    );
    expect(headerProps).toContain(
      "traits: manifest.details.identifiedUserTraits",
    );
    expect(headerProps).toContain("isLive: isLive");
    expect(headerProps).toContain("startTimeUnixMs: startTimeUnixMs");
    /*
     * The clock reaches the header through the wrapper's subscription,
     * not as a prop from here: its readouts show whole seconds, so it
     * renders four times a second rather than thirty.
     */
    expect(headerProps).not.toContain("currentTimeMs:");
    expect(headerProps).toContain("quantumMs={REPLAY_HEADER_CLOCK_MS}");
    expect(headerProps).toContain("onSwitchTab: switchTab");
  });

  /*
   * The recorder mints a new tab id on every page load, so a multi-page
   * visit arrives as a wall of "tabs" in opened order. The switcher can
   * only order them open-first, label them with their page and group them
   * in its picker if the shell hands it the summarised model rather than
   * the bare id/label/duration triple it used to build inline.
   */
  test("the header is handed summarised tabs, including which are still open", () => {
    const summary: string = slice(
      SOURCE,
      "const headerTabs:",
      "const continueInTab:",
    );

    expect(summary).toContain("summarizeReplayTabs({");
    expect(summary).toContain("tabs: manifest.tabs,");
    expect(summary).toContain("activeTabId: activeTabId,");
    expect(summary).toContain("isSessionFinalized: manifest.isFinalized,");
    expect(summary).toContain(
      "hasSessionRecordingEnded: manifest.hasRecordingEnded,",
    );
    /* The inline literal that read every tab as status-unknown. */
    expect(summary).not.toContain("label: `Tab ${index + 1}`");

    const headerProps: string = slice(SOURCE, "<ReplayHeaderClocked\n", "/>");

    expect(headerProps).toContain("tabs: headerTabs");
  });

  /*
   * The tab picker draws each tab's span against the SESSION clock, and
   * the two durations here are not the same number: the engine's is the
   * footage of the tab being watched (the header's clock reads "0:41 /
   * 4:12" within one tab), the manifest's is the whole recording. Handing
   * the engine's down scaled every tab by one tab's length, which piled
   * every later tab's bar against the right edge of the track.
   */
  test("the header is given the whole recording's length beside the playhead's", () => {
    const headerProps: string = slice(SOURCE, "<ReplayHeaderClocked\n", "/>");

    expect(headerProps).toContain(
      "durationMs: snapshot.durationMs || manifest.durationMs,",
    );
    expect(headerProps).toContain("sessionDurationMs: manifest.durationMs,");
    /* Not the engine's, which is exactly the bug. */
    expect(headerProps).not.toContain("sessionDurationMs: snapshot.durationMs");
    expect(headerProps).not.toContain("sessionDurationMs: durationMs");
  });

  test("drops blank facts rather than rendering an empty row for each", () => {
    expect(SOURCE).toMatch(/return Boolean\(fact\.value\);/);
  });

  test("labels the mobile app and recording source without changing web facts", () => {
    expect(SOURCE).toContain(
      "label: getReplayClientLabel(details.recorderKind)",
    );
    expect(SOURCE).toContain(
      "value: isMobileSessionReplay(details.recorderKind)",
    );
    expect(SOURCE).toContain(
      "getReplayRecorderKindLabel(details.recorderKind)",
    );
  });

  test("copy link builds the moment route with a zero pre-roll", () => {
    const builder: string = slice(
      SOURCE,
      "const buildMomentUrl",
      "const copyLink",
    );

    expect(builder).toContain("buildReplayMomentRoute({");
    expect(builder).toContain("preRollMs: 0");
    expect(builder).toContain("signal: selectedSignalId");
  });

  test("the Sessions link restores the stamped list URL", () => {
    expect(SOURCE).toContain("readReplayListUrl()");
    expect(SOURCE).toContain("Navigation.isSafeInternalRoute(backHref)");
  });

  /*
   * ux-10: the rail row's "Copy link to this moment" wrote straight to
   * navigator.clipboard, so it confirmed nothing on success and swallowed
   * the failure on a plain-http install. It goes through the header's
   * announced-and-fallback path now, like the Link button beside it.
   */
  test("the rail row's copy link goes through the header's announced copy path", () => {
    const copier: string = slice(
      SOURCE,
      "const copySignalLink",
      "const selectSignal",
    );

    expect(copier).toContain("headerRef.current?.copyUrl(");
    expect(copier).not.toContain("navigator.clipboard");
    /* Nothing anywhere in the shell may write to the clipboard directly. */
    expect(SOURCE).not.toContain("navigator.clipboard");
  });
});

/*
 * github.com/OneUptime/oneuptime/issues/3705: "this user's other
 * sessions" in the header. What only the shell can get wrong is pinned:
 * the lookup is keyed on the identity keys and the session clock (so the
 * 30s live poll, which replaces the manifest object every tick, never
 * re-fetches it), a cancelled or superseded lookup never sets state, the
 * header is handed the state and the navigation, and moving to another
 * session is a route change through the shared moment builder so the
 * page remounts the player exactly as the list would.
 */
describe("this user's other sessions", () => {
  const lookup: string = slice(
    SOURCE,
    "const kind: ReplayUserSessionsKind = resolveReplayUserSessionsKind({",
    "const isAwaitingFinalization: boolean",
  );

  test("the lookup effect is keyed on the session, the identity keys and the clock, not the manifest object", () => {
    const dependencies: string = slice(
      lookup,
      "}, [\n    rumApplicationIdString,",
      "manifest?.startTimeUnixMs,",
    );

    expect(dependencies).toContain("sessionId,");
    expect(dependencies).toContain("manifest?.details.identifiedUserKey,");
    expect(dependencies).toContain("manifest?.details.visitorId,");
    /* Listing the object would re-run the lookup on every live poll. */
    expect(dependencies).not.toMatch(/\n\s+manifest,\n/);
    expect(dependencies).not.toContain("viewId");
    expect(dependencies).not.toContain("reloadToken");
  });

  test("the lookup goes through the shared fetch and merge, once per generation", () => {
    expect(lookup).toContain("fetchReplayUserSessions({");
    expect(lookup).toContain("mergeReplayUserSessions(lists, self)");
    expect(lookup).toContain("buildReplayUserSessionsWindow(");
    expect(lookup).toContain("userSessionsGenerationRef.current += 1;");
    expect(lookup).toMatch(
      /if \(isCancelled \|\| generation !== userSessionsGenerationRef\.current\) \{\s*return;\s*\}/,
    );
    expect(lookup).toMatch(/return \(\) => \{\s*isCancelled = true;\s*\};/);
    /* A session with neither key never makes a request. */
    expect(lookup).toMatch(
      /if \(kind === "none"\) \{[\s\S]*?kind: "none",[\s\S]*?return;\s*\}/,
    );
  });

  test("the header is handed the visitor id with the identity and the lookup state after the pin control", () => {
    const headerProps: string = slice(SOURCE, "<ReplayHeaderClocked\n", "/>");

    /* Inside the pinned identity block, next to the two existing keys. */
    expect(headerProps).toContain("visitorId: manifest.details.visitorId");

    const headerElement: string = slice(
      SOURCE,
      "<ReplayHeaderClocked\n",
      "{recordingNotes.length > 0 && (",
    );
    const pinIndex: number = headerElement.indexOf("pinControl: (");
    const stateIndex: number = headerElement.indexOf(
      "userSessions: displayedUserSessions",
    );
    const openIndex: number = headerElement.indexOf(
      "onOpenUserSession: openUserSession",
    );

    expect(pinIndex).toBeGreaterThan(-1);
    expect(stateIndex).toBeGreaterThan(pinIndex);
    expect(openIndex).toBeGreaterThan(pinIndex);
  });

  test("opening another session is a route change through the moment builder, with the rail tab and no pre-roll", () => {
    const opener: string = slice(
      SOURCE,
      "const openUserSession",
      "const adjacentUserSessions",
    );

    expect(opener).toContain("buildReplayMomentRoute({");
    expect(opener).toContain("sessionId: targetSessionId,");
    expect(opener).toContain("rail: railTab,");
    expect(opener).toContain("preRollMs: 0,");
    expect(opener).toContain("Navigation.navigate(route)");
    /* Never a state change: the page keys the player on the session. */
    expect(opener).not.toContain("setManifest(");
    expect(opener).not.toContain("setReloadToken(");
    expect(opener).toMatch(
      /if \(!targetSessionId \|\| targetSessionId === sessionId\) \{\s*return;\s*\}/,
    );
  });

  test("the { and } keys reach the older/newer steps through the scrubber's shell-level handlers", () => {
    const scrubberProps: string = slice(SOURCE, "<ReplayScrubber\n", "/>");

    expect(scrubberProps).toContain(
      "onOlderUserSession={openOlderUserSession}",
    );
    expect(scrubberProps).toContain(
      "onNewerUserSession={openNewerUserSession}",
    );
    expect(SOURCE).toContain(
      "findAdjacentUserSessions(displayedUserSessions.sessions, sessionId)",
    );
  });

  /*
   * A recording that runs out leaves the viewer with "what happened
   * next?" and, until now, no answer on the screen. The ended card offers
   * the same newer session the header's arrow opens, so discovery does
   * not depend on knowing the menu is there.
   */
  test("the ended card offers this user's next session, opened the same way as the arrows", () => {
    const next: string = slice(
      SOURCE,
      "const nextUserSession:",
      "const openOlderUserSession:",
    );

    expect(next).toContain("adjacentUserSessions.newer");
    expect(next).toContain("describeReplayUserSession(newer, Date.now())");
    expect(next).toContain("sessionId: newer.sessionId,");

    const overlayProps: string = slice(
      SOURCE,
      "<ReplayStageOverlaysClocked",
      "children: (",
    );

    expect(overlayProps).toContain("nextUserSession: nextUserSession");
    expect(overlayProps).toContain("onOpenNextUserSession: openUserSession");
  });

  /*
   * github.com/OneUptime/oneuptime/issues/3642: the lookup runs once, so
   * its row for the watched session kept pulsing "Recording now" after the
   * poll turned the Live pill off. The header and the older/newer steps get
   * the lookup state with that one entry overlaid from the latest manifest,
   * and the overlay is keyed on the flags, never on the manifest object
   * (which would be a new state for the header on every poll) - and never
   * re-runs the lookup.
   */
  test("the watched session's menu entry follows the manifest poll, without re-running the lookup", () => {
    const overlay: string = slice(
      SOURCE,
      "const displayedUserSessions: ReplayUserSessionsState =",
      "const adjacentUserSessions",
    );

    expect(overlay).toContain("overlayCurrentReplayUserSession(");
    expect(overlay).toContain("userSessions,");
    expect(overlay).toContain("isFinalized: isManifestFinalized,");
    expect(overlay).toContain("hasRecordingEnded: hasManifestRecordingEnded,");

    const dependencies: string = slice(overlay, "}, [", "]);");

    expect(dependencies).toContain("isManifestFinalized");
    expect(dependencies).toContain("hasManifestRecordingEnded");
    expect(dependencies).not.toMatch(/\bmanifest\b\s*,/);

    expect(SOURCE).toMatch(
      /const isManifestFinalized: boolean = manifest\?\.isFinalized \?\? false;/,
    );
    expect(SOURCE).toMatch(
      /const hasManifestRecordingEnded: boolean =\s*manifest\?\.hasRecordingEnded \?\? false;/,
    );

    /* Nothing hands the header the raw, point-in-time lookup state. */
    expect(SOURCE).not.toContain("userSessions: userSessions");
    /* The lookup's dependencies do not grow the two flags. */
    expect(lookup).not.toContain("manifest?.hasRecordingEnded");
    expect(lookup).not.toContain("manifest?.isFinalized");
  });

  test("still never writes to the clipboard directly", () => {
    expect(SOURCE).not.toContain("navigator.clipboard");
  });
});

/*
 * A customer's screenshot showed the amber "1 note about this recording"
 * banner three lines tall: the browser's disclosure triangle, the icon
 * and the text each on its own line, because <summary> defaults to
 * display: list-item. Both note banners are one flex row now, with the
 * native marker hidden and an explicit caret.
 */
describe("the notes banners", () => {
  test("both summaries are one flex row with the native marker hidden", () => {
    for (const testId of [
      "replay-recording-notes-summary",
      "replay-capture-notes-summary",
    ]) {
      const summaryIndex: number = SOURCE.indexOf(`data-testid="${testId}"`);

      expect(summaryIndex).toBeGreaterThan(-1);

      const openingTag: string = SOURCE.slice(
        SOURCE.lastIndexOf("<summary", summaryIndex),
        summaryIndex,
      );

      expect(openingTag).toContain("list-none");
      expect(openingTag).toContain("[&::-webkit-details-marker]:hidden");
      expect(openingTag).toMatch(/flex cursor-pointer items-center gap-1\.5/);
    }
  });

  test("the caret rotates with the details element's open state", () => {
    const banners: string = slice(
      SOURCE,
      'data-testid="replay-recording-notes"',
      "</details>",
    );

    expect(banners).toContain("group-open:rotate-90");
    expect(SOURCE).toMatch(
      /className="group mb-3 rounded-lg border border-amber-200/,
    );
    expect(SOURCE).toMatch(
      /className="group mt-3 rounded-lg border border-gray-200/,
    );
  });
});

describe("URL state", () => {
  test("the page parses the whole player URL model and keys the player on the session", () => {
    expect(VIEW_SOURCE).toContain("parseReplayPlayerUrlState(");
    expect(VIEW_SOURCE).toContain("initialUrlState={initialUrlState}");
    expect(VIEW_SOURCE).toMatch(
      /key=\{`\$\{modelId\.toString\(\)\}:\$\{route\.sessionId\}`\}/,
    );
    expect(VIEW_SOURCE).not.toContain("initialOffsetSeconds=");
  });

  /*
   * Switching to another recording is a path-parameter change on a route
   * element the routes component created once, so React reuses the element
   * object and bails out of the subtree: a view that read the ids from
   * window.location never re-rendered, and the mounted player carried on
   * polling the session it was already playing while the address bar said
   * otherwise. The subscription is the fix, so it is pinned here.
   */
  test("the page reads the session from the router's location, not from window.location", () => {
    expect(VIEW_SOURCE).toContain('from "react-router-dom"');
    expect(VIEW_SOURCE).toContain("useLocation()");
    expect(VIEW_SOURCE).toContain(
      "parseSessionReplayPlayerRoute(\n    location.pathname,\n  )",
    );
    expect(VIEW_SOURCE).toContain(
      "parseReplayPlayerUrlState(\n    location.search,\n  )",
    );
    expect(VIEW_SOURCE).not.toContain("Navigation.getLastParam");
    expect(VIEW_SOURCE).not.toContain("Navigation.getQueryString()");
  });

  test("rail, q, tab and signal are mirrored with replaceState (never pushState)", () => {
    const sync: string = slice(SOURCE, "Navigation.setQueryString({", "});");

    expect(sync).toContain("[REPLAY_URL_PARAM_TAB]");
    expect(sync).toContain("[REPLAY_URL_PARAM_RAIL]");
    expect(sync).toContain("[REPLAY_URL_PARAM_RAIL_SEARCH]");
    expect(sync).toContain("[REPLAY_URL_PARAM_SIGNAL]");
    expect(SOURCE).not.toContain("pushState");
  });

  test("the initial moment is resolved by the shared resolver (at wins over t)", () => {
    expect(SOURCE).toContain("resolveReplayInitialMoment({");
    expect(SOURCE).toContain("targetMs: moment.offsetMs");
  });

  /*
   * ux-08: the arrival notice used to hard-code "the linked log line" for
   * every ?at=, including links built from a span or an exception.
   */
  test("the arrival notice is derived from the signal the link carried", () => {
    expect(SOURCE).toContain("describeReplayMomentNotice({");
    expect(SOURCE).toContain("signal: urlState.signalId");
    expect(SOURCE).not.toContain("Opened at the moment of the linked log line");
  });

  /*
   * ux-11: a copied link must land the recipient on a tab that shows the
   * row, instead of on whichever rail tab they last used.
   */
  test("copied links always name a rail tab, including the default", () => {
    const momentUrl: string = slice(
      SOURCE,
      "const buildMomentUrl",
      "const copyLink",
    );
    const signalUrl: string = slice(
      SOURCE,
      "const copySignalLink",
      "const selectSignal",
    );

    expect(momentUrl).toContain("rail: railTab,");
    expect(momentUrl).not.toContain('railTab === "all" ? null : railTab');
    expect(signalUrl).toContain("homeRailTabForSignal(signal)");
  });

  test("a ?signal= with an explicit moment selects on the row's own tab without seeking", () => {
    const reveal: string = slice(
      SOURCE,
      "hasRevealedSignalRef.current ||",
      "const seekTo:",
    );

    expect(reveal).toContain("homeRailTabForSignal(target)");
    expect(reveal).toContain("isSignalInTab(target, current)");
    /* The seeking path stays the bare-?signal= one. */
    expect(reveal).toContain("railRef.current.revealSignal(urlState.signalId)");
  });

  /*
   * ux-12 / integration-004: the audit page's Reason column read "None
   * given" for every view because the player never sent one.
   */
  test("the first manifest request carries an access reason derived from the URL", () => {
    expect(SOURCE).toContain("accessReason: describeReplayAccessReason(");

    const transport: string = slice(
      SOURCE,
      "async function fetchManifest",
      "const response: HTTPResponse<JSONObject>",
    );

    expect(transport).toContain('body["accessReason"] = args.accessReason;');
    /* A refresh reuses the existing audit row, so it must not resend one. */
    expect(transport).toMatch(
      /if \(args\.refresh\) \{[\s\S]*?\} else if \(args\.accessReason\)/,
    );
  });
});
