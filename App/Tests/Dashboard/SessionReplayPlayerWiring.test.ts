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
 *     between two recordings never reuses one session's state for the next.
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

describe("live sessions", () => {
  test("the poll re-fetches the manifest with isRefresh and the existing viewId", () => {
    const pollEffect: string = slice(
      SOURCE,
      "const poll: () => Promise<void>",
      "}, [isLive, viewId,",
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

  test("only the initial load makes a bare (audit-writing) manifest request", () => {
    const bareCalls: number = (
      SOURCE.match(
        /fetchManifest\(\{\s*rumApplicationId: rumApplicationIdString,\s*sessionId: sessionId,\s*\}\)/g,
      ) ?? []
    ).length;

    expect(bareCalls).toBe(1);
  });

  test("polling is gated on the session not being finalized", () => {
    expect(SOURCE).toContain(
      "const isLive: boolean = manifest !== null && !manifest.isFinalized;",
    );
    expect(SOURCE).toMatch(/if \(!isLive\) \{\s*return;\s*\}/);
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
    const rowStart: number = SOURCE.lastIndexOf("xl:flex-row");
    const stageIndex: number = SOURCE.indexOf("<ReplayStageOverlays", rowStart);
    const railColumnIndex: number = SOURCE.indexOf(
      'data-testid="replay-rail-column"',
      rowStart,
    );

    expect(stageIndex).toBeGreaterThan(-1);
    expect(railColumnIndex).toBeGreaterThan(stageIndex);
    expect(SOURCE.indexOf("<ReplayRail\n")).toBeGreaterThan(-1);
  });

  test("is handed the playhead, the transport state, the selection and the seek", () => {
    const railProps: string = slice(
      SOURCE,
      "<ReplayRail\n      ref={railRef}",
      "/>",
    );

    expect(railProps).toContain("currentTimeMs={snapshot.currentTimeMs}");
    expect(railProps).toContain('isPlaying={snapshot.phase === "playing"}');
    expect(railProps).toContain("selectedSignalId={selectedSignalId}");
    expect(railProps).toContain("onSeek={seekTo}");
    expect(railProps).toContain("backendStore={backendStore}");
    expect(railProps).toContain("isExpiredFootage={!isPlayable}");
    expect(railProps).toContain("onTelemetrySignalsChange=");
  });

  test("stays mounted in the no-footage mode so telemetry still loads", () => {
    /* The rail element is built once and rendered regardless of isPlayable. */
    expect(SOURCE).toContain("const railElement: ReactElement = (");
    expect(SOURCE).toMatch(/\{railElement\}/);
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
    const headerProps: string = slice(SOURCE, "<ReplayHeader\n", "/>");

    expect(headerProps).toContain(
      "label: manifest.details.identifiedUserLabel",
    );
    expect(headerProps).toContain(
      "traits: manifest.details.identifiedUserTraits",
    );
    expect(headerProps).toContain("isLive={isLive}");
    expect(headerProps).toContain("startTimeUnixMs={startTimeUnixMs}");
    expect(headerProps).toContain("currentTimeMs={snapshot.currentTimeMs}");
    expect(headerProps).toContain("onSwitchTab={switchTab}");
  });

  test("drops blank facts rather than rendering an empty row for each", () => {
    expect(SOURCE).toMatch(/return Boolean\(fact\.value\);/);
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
});

describe("URL state", () => {
  test("the page parses the whole player URL model and keys the player on the session", () => {
    expect(VIEW_SOURCE).toContain("parseReplayPlayerUrlState(");
    expect(VIEW_SOURCE).toContain("initialUrlState={initialUrlState}");
    expect(VIEW_SOURCE).toMatch(
      /key=\{`\$\{modelId\.toString\(\)\}:\$\{sessionId\}`\}/,
    );
    expect(VIEW_SOURCE).not.toContain("initialOffsetSeconds=");
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
});
