import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  buildReplayScreenshotFileName,
  formatReplayScreenshotOffset,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScreenshot";
import {
  REPLAY_FRAME_BROKEN_IMAGE,
  REPLAY_FRAME_MAX_CANVAS_PIXELS,
  REPLAY_FRAME_MAX_PIXEL_RATIO,
  REPLAY_FRAME_ROOT_SELECTOR,
  resolveReplayFramePixelRatio,
  rewriteReplayCss,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayFrameCapture";

/*
 * The paused frame's screenshot dock ("Copy image" / "Download"), wired
 * through the player shell. SessionReplayPlayer cannot be rendered in a
 * unit test (see SessionReplayPlayerWiring.test.ts); the dock itself, the
 * overlays that host it and the capture are rendered and exercised in
 * Common/Tests/UI/Rum. What is pinned here is the wiring and the
 * invariants a text search can prove and a render cannot:
 *
 *   - the shell's capture reads the Replayer, the playhead, the manifest
 *     and the active tab through refs AT CLICK TIME - the Replayer is
 *     replaced on a seek across anchors or a tab switch, so a value
 *     closed over at render time would photograph a torn-down iframe or
 *     name the file after a stale playhead;
 *   - the dock is offered behind the same "a replay document has been
 *     drawn" gate as Select text, and only while paused, outside text
 *     selection;
 *   - the shell still never touches the clipboard, and nothing in the
 *     screenshot files reaches rrweb;
 *   - the capture never makes a network request and never builds a blob:
 *     URL for the SVG (a blob: SVG taints the canvas in Chromium and
 *     WebKit, and toBlob then throws);
 *   - the ClipboardItem is built with the PENDING image before anything is
 *     awaited, because Safari drops a clipboard write that does not start
 *     inside the click;
 *   - a busy dock button is aria-disabled, never disabled (a disabled
 *     button drops the focus to <body>, where Space is play/pause), and
 *     the stage isolates the engine's mount so the Replayer's pointer
 *     z-index cannot paint over the dock;
 *   - measuring the live replay document only reads it, and the PNG size
 *     the dock shows comes from the same ratio the capture draws at.
 *
 * The file name and the CSS rewrite are pure, and are checked by value at
 * the end, in this same node environment.
 *
 * Structural, not cosmetic: nothing here asserts a colour, a spacing class
 * or a label.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

const REPLAY_DIR: string = path.join(DASHBOARD_SRC, "Components/SessionReplay");

const PLAYER_PATH: string = path.join(REPLAY_DIR, "SessionReplayPlayer.tsx");
const OVERLAYS_PATH: string = path.join(REPLAY_DIR, "ReplayStageOverlays.tsx");
const CAPTURE_PATH: string = path.join(REPLAY_DIR, "ReplayFrameCapture.ts");
const SCREENSHOT_PATH: string = path.join(REPLAY_DIR, "ReplayScreenshot.ts");
const ACTIONS_PATH: string = path.join(
  REPLAY_DIR,
  "ReplayScreenshotActions.tsx",
);
const TABS_PATH: string = path.join(REPLAY_DIR, "ReplayTabs.ts");
const STAGE_PATH: string = path.join(REPLAY_DIR, "ReplayStage.tsx");

/*
 * Comments are stripped before searching: these files explain in prose
 * why they never fetch, never use a blob: URL and never write to
 * navigator.clipboard, and a naive search would match the explanation.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readSource(filePath: string): string {
  return stripComments(fs.readFileSync(filePath, "utf8"));
}

const SOURCE: string = readSource(PLAYER_PATH);
const OVERLAYS_SOURCE: string = readSource(OVERLAYS_PATH);
const CAPTURE_SOURCE: string = readSource(CAPTURE_PATH);
const SCREENSHOT_SOURCE: string = readSource(SCREENSHOT_PATH);
const ACTIONS_SOURCE: string = readSource(ACTIONS_PATH);
const TABS_SOURCE: string = readSource(TABS_PATH);
const STAGE_SOURCE: string = readSource(STAGE_PATH);

/* The text between two markers, so an assertion can be scoped to one region. */
function slice(source: string, fromMarker: string, toMarker: string): string {
  const start: number = source.indexOf(fromMarker);

  expect(start).toBeGreaterThan(-1);

  const end: number = source.indexOf(toMarker, start);

  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/* The shell's capture callback, up to (not including) its dependency list. */
function captureFrameBody(): string {
  return slice(SOURCE, "const captureFrame:", "}, [");
}

function captureFrameDependencies(): string {
  const fromCapture: string = SOURCE.slice(
    SOURCE.indexOf("const captureFrame:"),
  );

  return slice(fromCapture, "}, [", "]);");
}

function overlayProps(): string {
  return slice(SOURCE, "<ReplayStageOverlaysClocked", "children: (");
}

describe("the shell's capture callback", () => {
  test("is a memoised callback that returns the screenshot promise", () => {
    expect(SOURCE).toMatch(
      /const captureFrame: \(\) => Promise<ReplayScreenshot> =\s*useCallback\(\(\): Promise<ReplayScreenshot> => \{/,
    );
    expect(countOccurrences(SOURCE, "const captureFrame:")).toBe(1);
    expect(captureFrameBody()).toContain("return captureReplayerScreenshot({");
  });

  test("goes through the player glue, never the frame capture or the clipboard directly", () => {
    expect(SOURCE).toMatch(
      /import \{\s*ReplayScreenshot,\s*captureReplayerScreenshot,\s*\} from "\.\/ReplayScreenshot";/,
    );
    expect(SOURCE).not.toContain('from "./ReplayFrameCapture"');
    expect(SOURCE).not.toContain("captureReplayFrame(");
    expect(SOURCE).not.toContain("serializeReplayFrame(");
    expect(SOURCE).not.toContain("ClipboardItem");
    expect(SOURCE).not.toContain("copyReplayScreenshotToClipboard");
    expect(SOURCE).not.toContain("downloadReplayScreenshot");
  });

  test("reads the live Replayer from its ref at click time", () => {
    expect(captureFrameBody()).toContain("replayer: replayerRef.current,");
  });

  test("names the file after the engine's live playhead, not a rendered snapshot", () => {
    const body: string = captureFrameBody();

    expect(body).toContain(
      "offsetMs: engineRef.current?.getSnapshot().currentTimeMs ?? 0,",
    );
    /* The render-time snapshot the overlays draw from is never consulted. */
    expect(body).not.toMatch(/\bsnapshot\b/);
    expect(body).not.toContain("currentTimeMs:");
  });

  test("reads the manifest and the active tab through refs, never render-time state", () => {
    const body: string = captureFrameBody();

    expect(body).toContain("manifestRef.current");
    expect(body).toContain("activeTabIdRef.current");
    /* `manifest` and `activeTabId` are the render-time state variables. */
    expect(body).not.toMatch(/\bmanifest\b/);
    expect(body).not.toMatch(/\bactiveTabId\b/);
    expect(body).not.toMatch(/\bengine\b/);
  });

  test("depends on nothing a render changes except the session id fallback", () => {
    const dependencies: string = captureFrameDependencies();

    expect(dependencies).toContain("sessionId");
    expect(dependencies).not.toMatch(
      /\b(snapshot|manifest|engine|activeTabId|replayer|isPlayable)\b/,
    );
  });

  test("prefers the manifest's session id and falls back to the route's", () => {
    expect(captureFrameBody()).toContain(
      "sessionId: currentManifest?.sessionId || sessionId,",
    );
  });

  test("names the tab only when the session has several, with the header's own label", () => {
    const body: string = captureFrameBody();

    expect(body).toContain("tabs.length > 1 && tabIndex >= 0");
    expect(body).toContain("`Tab ${tabIndex + 1}`");
    expect(body).toMatch(/: null,\s*\}\);/);
    /* The header's tab strip counts the same manifest tabs from one. */
    expect(TABS_SOURCE).toContain("label: `Tab ${index + 1}`");
  });

  test("the refs it reads are the ones the shell keeps current", () => {
    expect(SOURCE).toContain(
      "const replayerRef: React.MutableRefObject<ReplayerLike | null> =",
    );
    expect(SOURCE).toContain(
      "const engineRef: React.MutableRefObject<ReplayEngine | null> =",
    );
    expect(SOURCE).toContain(
      "const manifestRef: React.MutableRefObject<SessionReplayManifest | null> =",
    );
    expect(SOURCE).toContain(
      'const activeTabIdRef: React.MutableRefObject<string> = useRef<string>("");',
    );
    expect(SOURCE).toContain("replayerRef.current = event.replayer;");
  });
});

describe("the overlay props", () => {
  test("hand the dock the shell's capture callback", () => {
    expect(overlayProps()).toContain("onCaptureFrame: captureFrame,");
  });

  test("gate the dock on a drawn replay document, exactly like Select text", () => {
    const props: string = overlayProps();
    const gate: string =
      "isPlayable && engine !== null && isReplayDocumentReady,";

    expect(props).toMatch(
      /canCaptureFrame:\s*isPlayable && engine !== null && isReplayDocumentReady,/,
    );
    expect(props).toMatch(
      /canSelectText:\s*isPlayable && engine !== null && isReplayDocumentReady,/,
    );
    expect(countOccurrences(props, gate)).toBe(2);
  });

  test("are passed once each", () => {
    const props: string = overlayProps();

    expect(countOccurrences(props, "onCaptureFrame:")).toBe(1);
    expect(countOccurrences(props, "canCaptureFrame:")).toBe(1);
  });
});

describe("the clipboard boundary", () => {
  test("the shell still never writes to the clipboard directly", () => {
    expect(SOURCE).not.toContain("navigator.clipboard");
  });

  test("the dock reaches the clipboard only through the player glue", () => {
    expect(ACTIONS_SOURCE).not.toContain("navigator.clipboard");
    expect(ACTIONS_SOURCE).not.toContain("new ClipboardItem(");
    expect(ACTIONS_SOURCE).toContain(
      "props.copyToClipboard ?? copyReplayScreenshotToClipboard",
    );
    expect(ACTIONS_SOURCE).toContain(
      "props.download ?? downloadReplayScreenshot",
    );
  });

  test("the frame capture never touches the clipboard", () => {
    expect(CAPTURE_SOURCE).not.toContain("navigator.clipboard");
    expect(CAPTURE_SOURCE).not.toContain("ClipboardItem");
  });

  test("builds the ClipboardItem with the pending image before its first await", () => {
    const copier: string = slice(
      SCREENSHOT_SOURCE,
      "export async function copyReplayScreenshotToClipboard(",
      "export const REPLAY_SCREENSHOT_URL_TTL_MS",
    );
    const itemIndex: number = copier.indexOf("new ClipboardItem(");
    const firstAwaitIndex: number = copier.indexOf("await ");

    expect(itemIndex).toBeGreaterThan(-1);
    expect(firstAwaitIndex).toBeGreaterThan(itemIndex);
    /* The promise parameter itself, not a blob awaited out of it. */
    expect(copier).toMatch(
      /copyReplayScreenshotToClipboard\(\s*image: Promise<Blob>,?\s*\)/,
    );
    expect(copier).toMatch(
      /new ClipboardItem\(\{\s*"image\/png": image\s*\}\)/,
    );
    expect(copier.indexOf("navigator.clipboard.write(")).toBeLessThan(
      firstAwaitIndex,
    );
  });

  test("reports the capture's failure ahead of the clipboard's", () => {
    const copier: string = slice(
      SCREENSHOT_SOURCE,
      "export async function copyReplayScreenshotToClipboard(",
      "export const REPLAY_SCREENSHOT_URL_TTL_MS",
    );
    const awaitImage: number = copier.indexOf("await image;");
    const awaitWrite: number = copier.indexOf("await write;");

    expect(awaitImage).toBeGreaterThan(-1);
    expect(awaitWrite).toBeGreaterThan(awaitImage);
  });

  test("the dock hands the clipboard the capture inside the click, with nothing awaited first", () => {
    const copyImage: string = slice(
      ACTIONS_SOURCE,
      "const copyImage:",
      "const downloadImage:",
    );

    expect(copyImage).toMatch(
      /const copyImage: \(\) => void = useCallback\(\(\): void => \{/,
    );
    expect(copyImage).not.toContain("async");
    expect(copyImage).not.toContain("await");
    expect(copyImage.indexOf("startCapture()")).toBeLessThan(
      copyImage.indexOf("copyToClipboard("),
    );
  });
});

describe("the rrweb boundary", () => {
  test("none of the screenshot files names the rrweb package", () => {
    const anyRrwebReference: RegExp = /["']rrweb["']/;

    for (const source of [CAPTURE_SOURCE, SCREENSHOT_SOURCE, ACTIONS_SOURCE]) {
      expect(anyRrwebReference.test(source)).toBe(false);
    }
  });

  test("none of them has a dynamic import that could pull a chunk in", () => {
    const dynamicImport: RegExp = /\bimport\s*\(/;

    for (const source of [CAPTURE_SOURCE, SCREENSHOT_SOURCE, ACTIONS_SOURCE]) {
      expect(dynamicImport.test(source)).toBe(false);
    }
  });
});

describe("the frame capture", () => {
  test("makes no network request of any kind", () => {
    const networkPatterns: Array<RegExp> = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bsendBeacon\b/,
      /\bWebSocket\b/,
      /\bEventSource\b/,
      /\bimport\s*\(/,
      /\bimportScripts\b/,
      /\bnew\s+Worker\b/,
    ];

    for (const pattern of networkPatterns) {
      expect({
        pattern: String(pattern),
        found: pattern.test(CAPTURE_SOURCE),
      }).toEqual({ pattern: String(pattern), found: false });
    }
  });

  test("hands the image loader a data: URL, never a blob: one", () => {
    const blobUrlLiteral: RegExp = /["'`]blob:/;

    expect(CAPTURE_SOURCE).not.toContain("createObjectURL");
    expect(blobUrlLiteral.test(CAPTURE_SOURCE)).toBe(false);
    expect(CAPTURE_SOURCE).toContain("`data:image/svg+xml;base64,${btoa(");
    expect(CAPTURE_SOURCE).toContain("deps.loadImage(toSvgDataUrl(svg))");
  });

  test("builds the clone in an inert document of its own", () => {
    expect(CAPTURE_SOURCE).toContain(
      'this.output = replayDocument.implementation.createHTMLDocument("");',
    );
    /* Nothing is created in, or written to, the live replay document. */
    expect(CAPTURE_SOURCE).not.toMatch(
      /this\.document\.(createElement|createElementNS|createTextNode|write|writeln|open|close|importNode|adoptNode)\b/,
    );
  });

  test("reads scroll offsets but never scrolls the live document", () => {
    const scrollWrite: RegExp = /\.scroll(Top|Left)\s*=[^=]/;
    const scrollCall: RegExp = /\.scroll(To|By|IntoView)\s*\(/;

    expect(scrollWrite.test(CAPTURE_SOURCE)).toBe(false);
    expect(scrollCall.test(CAPTURE_SOURCE)).toBe(false);
    expect(CAPTURE_SOURCE).toContain("this.rootScroller.scrollTop || 0");
  });

  test("freezes animations in the clone without pausing the live ones", () => {
    const animationControl: RegExp =
      /\.(pause|play|finish|cancel|reverse)\(\s*\)/;

    expect(animationControl.test(CAPTURE_SOURCE)).toBe(false);
    expect(CAPTURE_SOURCE).toContain("effect.getKeyframes()");
  });

  test("takes its raster dependencies from the caller before the browser's", () => {
    expect(CAPTURE_SOURCE).toContain(
      "createCanvas: options?.deps?.createCanvas ?? createCanvasDefault,",
    );
    expect(CAPTURE_SOURCE).toContain(
      "loadImage: options?.deps?.loadImage ?? loadImageDefault,",
    );
    expect(CAPTURE_SOURCE).toContain(
      "nextFrame: options?.deps?.nextFrame ?? nextFrameDefault,",
    );
    /* The player glue passes them through for its own tests. */
    expect(SCREENSHOT_SOURCE).toContain("deps: request.deps,");
  });

  test("clones synchronously and only rasterises asynchronously", () => {
    const capture: string = slice(
      CAPTURE_SOURCE,
      "export function captureReplayFrame(",
      "return rasterizeReplayFrame(",
    );

    expect(capture).not.toContain("async");
    expect(capture).not.toContain("await");
    expect(capture).toContain(
      "serialization = serializeReplayFrame(input.document, input.viewport);",
    );
  });
});

describe("the overlays", () => {
  test("render the dock exactly once, behind the availability condition", () => {
    expect(countOccurrences(OVERLAYS_SOURCE, "<ReplayScreenshotActions")).toBe(
      1,
    );
    expect(OVERLAYS_SOURCE).toMatch(
      /\{isScreenshotAvailable && props\.onCaptureFrame && \(\s*<ReplayScreenshotActions/,
    );
  });

  test("offer it only while paused and outside text selection, unless the shell says no", () => {
    const condition: string = slice(
      OVERLAYS_SOURCE,
      "const isScreenshotAvailable: boolean =",
      ";",
    );

    expect(condition).toContain('phase === "paused"');
    expect(condition).toContain("!isTextSelectionActive");
    expect(condition).toContain("props.canCaptureFrame !== false");
    /* Every clause is required: none of them is an alternative. */
    expect(condition).not.toContain("||");
  });

  test("never offer it in the no-footage mode, which returns before the stage", () => {
    const absenceIndex: number = OVERLAYS_SOURCE.indexOf(
      "if (props.absence) {",
    );
    const dockIndex: number = OVERLAYS_SOURCE.indexOf(
      "<ReplayScreenshotActions",
    );

    expect(absenceIndex).toBeGreaterThan(-1);
    expect(dockIndex).toBeGreaterThan(absenceIndex);
    expect(
      slice(
        OVERLAYS_SOURCE,
        "if (props.absence) {",
        "let centreOverlay: ReactElement | null = null;",
      ),
    ).not.toContain("ReplayScreenshotActions");
  });

  test("draw it after the centre overlay so it paints above the play button", () => {
    const centreIndex: number = OVERLAYS_SOURCE.indexOf("{centreOverlay && (");
    const dockIndex: number = OVERLAYS_SOURCE.indexOf(
      "<ReplayScreenshotActions",
    );

    expect(centreIndex).toBeGreaterThan(-1);
    expect(dockIndex).toBeGreaterThan(centreIndex);
  });

  test("key the frame on the generation and the rounded playhead", () => {
    const dock: string = slice(
      OVERLAYS_SOURCE,
      "<ReplayScreenshotActions",
      "/>",
    );

    expect(dock).toContain("onCapture={props.onCaptureFrame}");
    expect(dock).toContain("fit={props.fit}");
    expect(dock).toContain(
      "frameKey={`${snapshot.generation}:${Math.round(currentTimeMs)}`}",
    );
    /* No test seam leaks into the production composition. */
    expect(dock).not.toContain("copyToClipboard=");
    expect(dock).not.toContain("download=");
    expect(dock).not.toContain("clipboardSupport=");
  });
});

describe("the dock's buttons", () => {
  function dockButtonSource(ref: string): string {
    return slice(ACTIONS_SOURCE, `ref={${ref}}`, "</button>");
  }

  test("are marked busy with aria-disabled and never disabled natively", () => {
    const nativeDisabledProp: RegExp = /(^|[^-\w])disabled\s*=/;
    const disabledPropertyWrite: RegExp = /\.disabled\s*=[^=]/;

    expect(nativeDisabledProp.test(ACTIONS_SOURCE)).toBe(false);
    expect(disabledPropertyWrite.test(ACTIONS_SOURCE)).toBe(false);
    expect(ACTIONS_SOURCE).not.toContain('setAttribute("disabled"');
    expect(
      countOccurrences(ACTIONS_SOURCE, "aria-disabled={isBusy || undefined}"),
    ).toBe(2);

    for (const ref of ["copyButtonRef", "downloadButtonRef"]) {
      const button: string = dockButtonSource(ref);

      expect(button).toContain("aria-disabled={isBusy || undefined}");
      expect(button).toMatch(
        /aria-busy=\{busyAction === "(copy|download)" \|\| undefined\}/,
      );
    }
  });

  test("leave the one-capture-at-a-time guard to their handlers", () => {
    expect(dockButtonSource("copyButtonRef")).toContain("onClick={copyImage}");
    expect(dockButtonSource("downloadButtonRef")).toContain(
      "onClick={downloadImage}",
    );
    /* Checked before anything else, the clipboard path included. */
    expect(
      slice(ACTIONS_SOURCE, "const copyImage:", "clipboardSupport !=="),
    ).toContain("if (busyRef.current !== null) {");
    expect(slice(ACTIONS_SOURCE, "const begin:", "keepFocusInDock(")).toContain(
      "if (busyRef.current !== null) {",
    );
    expect(
      slice(ACTIONS_SOURCE, "const recover:", "failure.recovery"),
    ).toContain("busyRef.current !== null");
  });
});

describe("the stage", () => {
  test("isolates the engine's mount, so the Replayer's pointer z-index stays under the overlays", () => {
    const isolatedMount: RegExp =
      /<div ref=\{mountRef\} className="[^"]*\bisolate\b[^"]*"/;

    expect(countOccurrences(STAGE_SOURCE, "ref={mountRef}")).toBe(1);
    expect(isolatedMount.test(STAGE_SOURCE)).toBe(true);
    expect(STAGE_SOURCE).toContain("engine.attach(mount);");
  });
});

describe("measuring the live replay document", () => {
  function measureSource(): string {
    return slice(
      CAPTURE_SOURCE,
      "private measure(): void {",
      "private applyRootPropagation(",
    );
  }

  test("has no sticky-measuring pass and sets no style property anywhere", () => {
    expect(CAPTURE_SOURCE).not.toContain("measureSticky");
    expect(CAPTURE_SOURCE).not.toContain("style.setProperty(");
    expect(CAPTURE_SOURCE).not.toContain("style.removeProperty(");
    expect(CAPTURE_SOURCE).not.toContain(".style.cssText");
  });

  test("only reads the elements it measures", () => {
    const measure: string = measureSource();
    const writes: Array<RegExp> = [
      /\.setAttribute(NS)?\(/,
      /\.removeAttribute(NS)?\(/,
      /\.toggleAttribute\(/,
      /\.setProperty\(/,
      /\.removeProperty\(/,
      /\.classList\./,
      /\.style\.[\w-]+\s*=[^=]/,
      /\.(appendChild|insertBefore|replaceChild|removeChild|replaceWith|remove)\(/,
      /\.(innerHTML|outerHTML|textContent)\s*=[^=]/,
      /\.scroll(Top|Left)\s*=[^=]/,
    ];

    expect(measure).toContain("this.measureAnimations();");

    for (const pattern of writes) {
      expect({
        pattern: String(pattern),
        found: pattern.test(measure),
      }).toEqual({ pattern: String(pattern), found: false });
    }
  });
});

describe("the PNG size the dock shows", () => {
  test("comes from the ratio and the canvas size the capture itself uses", () => {
    const capture: string = slice(
      SCREENSHOT_SOURCE,
      "export function captureReplayerScreenshot(",
      "export type ReplayImageClipboardSupport",
    );

    expect(capture).toContain(
      "const pixelRatio: number = request.pixelRatio ?? getDevicePixelRatio();",
    );
    expect(capture).toMatch(
      /resolveReplayFrameCanvasSize\(\s*viewport,\s*resolveReplayFramePixelRatio\(pixelRatio, viewport\),?\s*\)/,
    );
    /* The capture is handed the same ratio, not a second reading of it. */
    expect(capture).toContain("pixelRatio: pixelRatio,");
    expect(countOccurrences(capture, "getDevicePixelRatio()")).toBe(1);
    expect(capture).toContain("pixelWidth: pixelSize.width,");
    expect(capture).toContain("pixelHeight: pixelSize.height,");
    expect(CAPTURE_SOURCE).toContain(
      "const size: ReplayFrameViewport = resolveReplayFrameCanvasSize(",
    );
  });

  test("falls back to the recorded viewport in the dock", () => {
    expect(ACTIONS_SOURCE).toContain(
      "pixelWidth: screenshot.pixelWidth ?? screenshot.width,",
    );
    expect(ACTIONS_SOURCE).toContain(
      "pixelHeight: screenshot.pixelHeight ?? screenshot.height,",
    );
  });
});

/* ---- Pure logic, by value. ---- */

describe("formatReplayScreenshotOffset", () => {
  test("writes minutes, zero-padded seconds and tenths", () => {
    expect(formatReplayScreenshotOffset(0)).toBe("0m00.0s");
    expect(formatReplayScreenshotOffset(7300)).toBe("0m07.3s");
    expect(formatReplayScreenshotOffset(247300)).toBe("4m07.3s");
    expect(formatReplayScreenshotOffset(725000)).toBe("12m05.0s");
  });

  test("adds hours past the hour, with zero-padded minutes", () => {
    expect(formatReplayScreenshotOffset(3600000)).toBe("1h00m00.0s");
    expect(formatReplayScreenshotOffset(3723400)).toBe("1h02m03.4s");
    expect(formatReplayScreenshotOffset(36000000)).toBe("10h00m00.0s");
  });

  test("truncates rather than rounds, so it never names a later moment", () => {
    expect(formatReplayScreenshotOffset(7399)).toBe("0m07.3s");
    expect(formatReplayScreenshotOffset(59999)).toBe("0m59.9s");
    expect(formatReplayScreenshotOffset(99.9)).toBe("0m00.0s");
  });

  test("rolls over at the minute and the hour", () => {
    expect(formatReplayScreenshotOffset(60000)).toBe("1m00.0s");
    expect(formatReplayScreenshotOffset(3599999)).toBe("59m59.9s");
  });

  test("never contains a character a file system rejects", () => {
    const unsafe: RegExp = /[:/\\*?"<>|\s]/;

    for (const offsetMs of [0, 999, 61500, 3723400, 86400000]) {
      expect(unsafe.test(formatReplayScreenshotOffset(offsetMs))).toBe(false);
    }
  });

  test("clamps a negative or non-finite playhead to zero", () => {
    expect(formatReplayScreenshotOffset(-500)).toBe("0m00.0s");
    expect(formatReplayScreenshotOffset(Number.NaN)).toBe("0m00.0s");
    expect(formatReplayScreenshotOffset(Number.POSITIVE_INFINITY)).toBe(
      "0m00.0s",
    );
  });
});

describe("buildReplayScreenshotFileName", () => {
  test("names the file after the short session id and the playhead", () => {
    expect(
      buildReplayScreenshotFileName({
        sessionId: "3f9a2c1b-77aa-4c3e-9d1f-0123456789ab",
        offsetMs: 247300,
      }),
    ).toBe("session-replay-3f9a2c1b-4m07.3s.png");
  });

  test("adds a slug of the tab label when there is one", () => {
    expect(
      buildReplayScreenshotFileName({
        sessionId: "3f9a2c1b-77aa",
        offsetMs: 247300,
        tabLabel: "Tab 2",
      }),
    ).toBe("session-replay-3f9a2c1b-tab-2-4m07.3s.png");
  });

  test("leaves the tab out when the label is empty or missing", () => {
    for (const tabLabel of [null, undefined, "", "   ", "!!!"]) {
      expect(
        buildReplayScreenshotFileName({
          sessionId: "3f9a2c1b",
          offsetMs: 1000,
          tabLabel: tabLabel,
        }),
      ).toBe("session-replay-3f9a2c1b-0m01.0s.png");
    }
  });

  test("keeps only lowercase letters and digits of the session id", () => {
    expect(
      buildReplayScreenshotFileName({
        sessionId: "AB/CD:EF..12",
        offsetMs: 0,
      }),
    ).toBe("session-replay-abcdef12-0m00.0s.png");
  });

  test("falls back to a neutral name when the session id has nothing usable", () => {
    for (const sessionId of ["", "----", "../"]) {
      expect(
        buildReplayScreenshotFileName({ sessionId: sessionId, offsetMs: 0 }),
      ).toBe("session-replay-session-0m00.0s.png");
    }
  });

  test("caps the tab slug and never leaves an edge dash on it", () => {
    const fileName: string = buildReplayScreenshotFileName({
      sessionId: "3f9a2c1b",
      offsetMs: 0,
      tabLabel: "  Checkout -- Payment step (secure) and more text  ",
    });
    const tabPart: string = fileName
      .replace("session-replay-3f9a2c1b-", "")
      .replace("-0m00.0s.png", "");

    expect(tabPart.length).toBeLessThanOrEqual(24);
    expect(tabPart.startsWith("-")).toBe(false);
    expect(tabPart.startsWith("checkout-payment")).toBe(true);
    expect(fileName).not.toContain("--");
  });

  /*
   * The slug is cut to 24 characters AFTER its edge dashes are trimmed, so
   * a cut that lands just past a word leaves a dash at the end, and the
   * join then writes "--" into the name.
   */
  test("never leaves a dash at the cut when a long tab label is truncated", () => {
    const fileName: string = buildReplayScreenshotFileName({
      sessionId: "3f9a2c1b",
      offsetMs: 0,
      tabLabel: "abcdefghijklmnopqrstuvw xyz",
    });

    expect(fileName).toBe(
      "session-replay-3f9a2c1b-abcdefghijklmnopqrstuvw-0m00.0s.png",
    );
    expect(fileName).not.toContain("--");
  });

  test("always produces a portable .png name", () => {
    const portable: RegExp = /^[a-z0-9.-]+\.png$/;

    for (const input of [
      { sessionId: "Ünïcode-Séssion", offsetMs: 12, tabLabel: "Tab ✓ 3" },
      { sessionId: "x", offsetMs: 3723400, tabLabel: "C:\\Windows\\path" },
      { sessionId: "", offsetMs: -1, tabLabel: null },
    ]) {
      expect(portable.test(buildReplayScreenshotFileName(input))).toBe(true);
    }
  });
});

describe("rewriteReplayCss", () => {
  test("empties every url() that is not a data: URL, quoted or not", () => {
    expect(
      rewriteReplayCss("a { background: url(https://cdn.x/a.png); }"),
    ).toBe(`a { background: url("${REPLAY_FRAME_BROKEN_IMAGE}"); }`);
    expect(rewriteReplayCss("a { background: url('/img/b.png') }")).toBe(
      `a { background: url("${REPLAY_FRAME_BROKEN_IMAGE}") }`,
    );
    expect(rewriteReplayCss('@font-face { src: URL("f.woff2") }')).toBe(
      `@font-face { src: url("${REPLAY_FRAME_BROKEN_IMAGE}") }`,
    );
  });

  test("keeps a data: URL exactly as written", () => {
    const css: string =
      'a { background: url("data:image/png;base64,AAAA"); b: url( data:image/gif;base64,R0 ) }';

    expect(rewriteReplayCss(css)).toBe(css);
  });

  test("does not end a url() at a parenthesis inside its quotes", () => {
    expect(rewriteReplayCss('a { b: url("x(1).png") c }')).toBe(
      `a { b: url("${REPLAY_FRAME_BROKEN_IMAGE}") c }`,
    );
  });

  test("rewrites :root to a selector that also matches the page root in the image", () => {
    expect(rewriteReplayCss(":root { --brand: #123456; }")).toBe(
      `${REPLAY_FRAME_ROOT_SELECTOR} { --brand: #123456; }`,
    );
    expect(rewriteReplayCss(":root.dark body, :ROOT[lang] a {}")).toBe(
      `${REPLAY_FRAME_ROOT_SELECTOR}.dark body, ${REPLAY_FRAME_ROOT_SELECTOR}[lang] a {}`,
    );
  });

  test("leaves a longer pseudo-class that merely starts with root alone", () => {
    expect(rewriteReplayCss(":root-ish {} :rooted {}")).toBe(
      ":root-ish {} :rooted {}",
    );
  });

  test("never touches strings or comments", () => {
    const css: string =
      "a::before { content: \"url(x) :root\" } /* url(y) :root */ b { content: 'url(z)' }";

    expect(rewriteReplayCss(css)).toBe(css);
  });

  test("returns plain CSS unchanged", () => {
    const css: string =
      "a { color: red; } @media (min-width: 10px) { b { x: y } }";

    expect(rewriteReplayCss(css)).toBe(css);
    expect(rewriteReplayCss("")).toBe("");
  });

  test("survives an unterminated url(), string or comment without throwing", () => {
    expect(rewriteReplayCss("a { b: url(https://x")).toBe(
      `a { b: url("${REPLAY_FRAME_BROKEN_IMAGE}")`,
    );
    expect(rewriteReplayCss('a { content: "open')).toBe('a { content: "open');
    expect(rewriteReplayCss("a { } /* open")).toBe("a { } /* open");
  });
});

describe("resolveReplayFramePixelRatio", () => {
  const laptop: { width: number; height: number } = {
    width: 1440,
    height: 900,
  };

  test("uses the requested ratio up to the cap", () => {
    expect(resolveReplayFramePixelRatio(1, laptop)).toBe(1);
    expect(resolveReplayFramePixelRatio(1.5, laptop)).toBe(1.5);
    expect(resolveReplayFramePixelRatio(2, laptop)).toBe(2);
    expect(resolveReplayFramePixelRatio(3, laptop)).toBe(
      REPLAY_FRAME_MAX_PIXEL_RATIO,
    );
  });

  test("never draws below 1x for a normal viewport", () => {
    expect(resolveReplayFramePixelRatio(0.5, laptop)).toBe(1);
    expect(resolveReplayFramePixelRatio(0, laptop)).toBe(1);
    expect(resolveReplayFramePixelRatio(-2, laptop)).toBe(1);
  });

  test("falls back to 1x for a missing or non-finite ratio", () => {
    expect(resolveReplayFramePixelRatio(undefined, laptop)).toBe(1);
    expect(resolveReplayFramePixelRatio(null, laptop)).toBe(1);
    expect(resolveReplayFramePixelRatio(Number.NaN, laptop)).toBe(1);
    expect(resolveReplayFramePixelRatio(Number.POSITIVE_INFINITY, laptop)).toBe(
      1,
    );
  });

  test("lowers the ratio so the canvas stays within the pixel budget", () => {
    const viewport: { width: number; height: number } = {
      width: 3840,
      height: 2160,
    };
    const ratio: number = resolveReplayFramePixelRatio(2, viewport);
    const pixels: number = viewport.width * viewport.height * ratio * ratio;

    expect(ratio).toBeLessThan(2);
    expect(ratio).toBeGreaterThan(1);
    expect(pixels).toBeLessThanOrEqual(REPLAY_FRAME_MAX_CANVAS_PIXELS + 1);
    expect(pixels).toBeGreaterThan(REPLAY_FRAME_MAX_CANVAS_PIXELS * 0.999);
  });

  test("may go below 1x for a viewport larger than the budget itself", () => {
    const viewport: { width: number; height: number } = {
      width: 8192,
      height: 4096,
    };
    const ratio: number = resolveReplayFramePixelRatio(1, viewport);

    expect(ratio).toBeLessThan(1);
    expect(
      viewport.width * viewport.height * ratio * ratio,
    ).toBeLessThanOrEqual(REPLAY_FRAME_MAX_CANVAS_PIXELS + 1);
  });

  test("keeps the ratio when the budget is met exactly", () => {
    expect(resolveReplayFramePixelRatio(2, { width: 2048, height: 2048 })).toBe(
      2,
    );
  });

  test("ignores the budget for an empty viewport", () => {
    expect(resolveReplayFramePixelRatio(2, { width: 0, height: 0 })).toBe(2);
  });
});
