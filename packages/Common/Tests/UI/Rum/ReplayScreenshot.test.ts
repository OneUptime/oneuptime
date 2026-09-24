import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  REPLAY_SCREENSHOT_URL_TTL_MS,
  ReplayClipboardFailure,
  ReplayScreenshot,
  ReplayScreenshotClipboardError,
  buildReplayScreenshotFileName,
  captureReplayerScreenshot,
  copyReplayScreenshotToClipboard,
  downloadReplayScreenshot,
  formatReplayScreenshotOffset,
  getReplayImageClipboardSupport,
  readReplayPointer,
  readReplayViewport,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScreenshot";
import {
  ReplayFrameCaptureError,
  ReplayFramePointer,
  ReplayFrameRasterDeps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayFrameCapture";
import { ReplayerLike } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";

/*
 * The player's side of the paused-frame screenshot: what the file is
 * called, which document and viewport get captured, where the stage's
 * pointer was, and the two browser APIs the PNG leaves through.
 *
 * Pinned here:
 *  - the file name: a colon-free playhead ("4m07.3s", floored, never
 *    rounded up into the next second), the first eight id characters,
 *    an optional tab slug, and nothing a Windows or macOS file system
 *    would refuse;
 *  - the recorded viewport comes from the iframe's width/height
 *    ATTRIBUTES (the Replayer's unscaled truth), the client box only as
 *    a fallback;
 *  - the pointer is the stage's .replayer-mouse, centred on its box and
 *    left out whenever the stage is not showing it;
 *  - captureReplayerScreenshot rejects with a ReplayFrameCaptureError
 *    (never throws) and hands its raster deps, pixel ratio and pointer
 *    through, without writing to the live replay document;
 *  - the clipboard write starts SYNCHRONOUSLY with the still-pending
 *    image promise - Safari only honours a write that begins inside the
 *    click, and the capture outlasts that window - and a capture failure
 *    is what the viewer hears when both the capture and the write fail;
 *  - the download's object URL outlives the click (Safari cancels a
 *    download whose URL is revoked in the same task), even when the
 *    click throws.
 *
 * Unhandled rejections: the test's `process` is jest's copy, whose
 * listeners never hear the real event, but jest-circus listens for
 * 'unhandledRejection' on the REAL process and fails whichever test is
 * running when it fires. Every "does not leave ... unhandled" test
 * therefore rejects the promise and then waits real macrotasks
 * (flushRejectionTracking), so Node's tracker runs - and would fail the
 * test - before the test ends. (An it.failing control cannot pin this:
 * it.failing judges only the test function's own outcome, not an error
 * circus records beside it.)
 */

const SESSION_ID: string = "3F9A2C1B-4D5E-4F60-9A7B-1C2D3E4F5A6B";
const OFFSET_MS: number = 247300;
const OBJECT_URL: string = "blob:https://oneuptime.test/7d1f0c52";
const REPLAY_BODY: string =
  '<main><h1>Checkout</h1><p>Total: $42</p><input id="email" /></main>';
const WINDOWS_RESERVED_CHARACTERS: Array<string> = [
  "<",
  ">",
  ":",
  '"',
  "/",
  "\\",
  "|",
  "?",
  "*",
];
const SAFE_FILE_NAME_PATTERN: RegExp = /^session-replay-[a-z0-9.-]+\.png$/;
const SVG_DATA_URL_PREFIX: string = "data:image/svg+xml;base64,";

/* Kept before any test installs fake timers. */
const realSetTimeout: typeof setTimeout = setTimeout;

/* ---- Globals the browser has and jsdom does not. ---- */

const restorers: Array<() => void> = [];

function overrideProperty(target: unknown, key: string, value: unknown): void {
  const previous: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(target, key);

  Object.defineProperty(target, key, {
    value: value,
    configurable: true,
    writable: true,
  });

  restorers.push((): void => {
    if (previous) {
      Object.defineProperty(target, key, previous);
    } else {
      delete (target as Record<string, unknown>)[key];
    }
  });
}

function restoreOverrides(): void {
  let restore: (() => void) | undefined = restorers.pop();

  while (restore) {
    restore();
    restore = restorers.pop();
  }
}

function defineGetter(target: unknown, key: string, get: () => unknown): void {
  Object.defineProperty(target, key, { configurable: true, get: get });
}

function sizeElement(
  element: HTMLElement,
  box: { client?: [number, number]; offset?: [number, number] },
): void {
  if (box.client) {
    const [width, height]: [number, number] = box.client;

    defineGetter(element, "clientWidth", (): number => {
      return width;
    });
    defineGetter(element, "clientHeight", (): number => {
      return height;
    });
  }

  if (box.offset) {
    const [width, height]: [number, number] = box.offset;

    defineGetter(element, "offsetWidth", (): number => {
      return width;
    });
    defineGetter(element, "offsetHeight", (): number => {
      return height;
    });
  }
}

/* ---- Promises the test settles by hand. ---- */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  isSettled: () => boolean;
}

function makeDeferred<T>(): Deferred<T> {
  let settled: boolean = false;
  const handlers: {
    resolve: ((value: T) => void) | null;
    reject: ((reason: unknown) => void) | null;
  } = { resolve: null, reject: null };
  const promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: unknown) => void): void => {
      handlers.resolve = resolve;
      handlers.reject = reject;
    },
  );

  return {
    promise: promise,
    resolve: (value: T): void => {
      settled = true;

      if (handlers.resolve) {
        handlers.resolve(value);
      }
    },
    reject: (reason: unknown): void => {
      settled = true;

      if (handlers.reject) {
        handlers.reject(reason);
      }
    },
    isSettled: (): boolean => {
      return settled;
    },
  };
}

/*
 * Two real macrotasks: microtasks drain, then Node's rejection tracker
 * runs, while the current test is still the one jest-circus blames.
 */
async function flushRejectionTracking(): Promise<void> {
  for (let pass: number = 0; pass < 2; pass++) {
    await new Promise<void>((resolve: () => void): void => {
      realSetTimeout(resolve, 0);
    });
  }
}

async function catchRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }

  throw new Error("expected the promise to reject");
}

function makePng(): Blob {
  return new Blob(["\u0089PNG fake frame"], { type: "image/png" });
}

/* ---- A Replayer with a real (jsdom) replay document. ---- */

interface ReplayerFixture {
  replayer: ReplayerLike;
  iframe: HTMLIFrameElement;
  wrapper: HTMLElement;
  replayDocument: Document;
}

function makeReplayerLike(
  iframe: HTMLIFrameElement,
  wrapper: HTMLElement,
): ReplayerLike {
  return {
    iframe: iframe,
    wrapper: wrapper,
    play: (): void => {
      // Not exercised by the screenshot.
    },
    pause: (): void => {
      // Not exercised by the screenshot.
    },
    destroy: (): void => {
      wrapper.remove();
    },
    addEvent: (): void => {
      // Not exercised by the screenshot.
    },
    getCurrentTime: (): number => {
      return OFFSET_MS;
    },
    setConfig: (): void => {
      // Not exercised by the screenshot.
    },
    on: (): unknown => {
      return undefined;
    },
  };
}

function makeReplayer(options?: {
  width?: string | null;
  height?: string | null;
  body?: string;
}): ReplayerFixture {
  const wrapper: HTMLElement = document.createElement("div");
  const iframe: HTMLIFrameElement = document.createElement("iframe");
  const width: string | null =
    options?.width === undefined ? "800" : options.width;
  const height: string | null =
    options?.height === undefined ? "600" : options.height;

  wrapper.className = "replayer-wrapper";

  if (width !== null) {
    iframe.setAttribute("width", width);
  }

  if (height !== null) {
    iframe.setAttribute("height", height);
  }

  wrapper.appendChild(iframe);
  document.body.appendChild(wrapper);

  const replayDocument: Document | null = iframe.contentDocument;

  if (!replayDocument) {
    throw new Error("jsdom gave the replay iframe no document");
  }

  replayDocument.body.innerHTML = options?.body ?? REPLAY_BODY;

  return {
    replayer: makeReplayerLike(iframe, wrapper),
    iframe: iframe,
    wrapper: wrapper,
    replayDocument: replayDocument,
  };
}

function addPointer(
  wrapper: HTMLElement,
  options?: { left?: string; top?: string; size?: [number, number] },
): HTMLElement {
  const pointer: HTMLElement = wrapper.ownerDocument.createElement("div");

  pointer.className = "replayer-mouse";

  if (options?.left !== "") {
    pointer.style.left = options?.left ?? "100px";
  }

  if (options?.top !== "") {
    pointer.style.top = options?.top ?? "50px";
  }

  wrapper.appendChild(pointer);

  if (options?.size) {
    sizeElement(pointer, { offset: options.size });
  }

  return pointer;
}

/* ---- The canvas and image loading jsdom does not have. ---- */

interface FakeRaster {
  deps: ReplayFrameRasterDeps;
  createCanvas: MockFunction;
  loadImage: MockFunction;
  nextFrame: MockFunction;
  toBlob: MockFunction;
  arc: MockFunction;
  drawImage: MockFunction;
  blob: Blob;
}

function makeRaster(options?: {
  blob?: Blob | null;
  hasContext?: boolean;
  loadImage?: (url: string) => Promise<CanvasImageSource>;
}): FakeRaster {
  const blob: Blob = makePng();
  const produced: Blob | null =
    options?.blob === undefined ? blob : options.blob;
  const arc: MockFunction = getJestMockFunction();
  const drawImage: MockFunction = getJestMockFunction();
  const context: Record<string, unknown> = {
    save: getJestMockFunction(),
    restore: getJestMockFunction(),
    beginPath: getJestMockFunction(),
    fill: getJestMockFunction(),
    stroke: getJestMockFunction(),
    clearRect: getJestMockFunction(),
    fillRect: getJestMockFunction(),
    arc: arc,
    drawImage: drawImage,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
  };
  const toBlob: MockFunction = getJestMockFunction().mockImplementation(
    (callback: BlobCallback): void => {
      callback(produced);
    },
  );
  const createCanvas: MockFunction = getJestMockFunction().mockImplementation(
    (width: number, height: number): HTMLCanvasElement => {
      const canvas: HTMLCanvasElement = document.createElement("canvas");

      canvas.width = width;
      canvas.height = height;
      Object.defineProperty(canvas, "getContext", {
        value: (): unknown => {
          return options?.hasContext === false ? null : context;
        },
      });
      Object.defineProperty(canvas, "toBlob", { value: toBlob });
      Object.defineProperty(canvas, "toDataURL", {
        value: (): string => {
          return "data:image/png;base64,AAAA";
        },
      });

      return canvas;
    },
  );
  const loadImage: MockFunction = getJestMockFunction().mockImplementation(
    options?.loadImage ??
      ((): Promise<CanvasImageSource> => {
        return Promise.resolve(document.createElement("img"));
      }),
  );
  const nextFrame: MockFunction = getJestMockFunction().mockImplementation(
    (): Promise<void> => {
      return Promise.resolve();
    },
  );

  return {
    deps: {
      createCanvas: createCanvas,
      loadImage: loadImage,
      nextFrame: nextFrame,
    },
    createCanvas: createCanvas,
    loadImage: loadImage,
    nextFrame: nextFrame,
    toBlob: toBlob,
    arc: arc,
    drawImage: drawImage,
    blob: blob,
  };
}

function decodeSvgDataUrl(url: string): string {
  expect(url.startsWith(SVG_DATA_URL_PREFIX)).toBe(true);

  const binary: string = atob(url.slice(SVG_DATA_URL_PREFIX.length));
  const bytes: Uint8Array = new Uint8Array(
    Array.from(binary, (character: string): number => {
      return character.charCodeAt(0);
    }),
  );

  return new TextDecoder().decode(bytes);
}

function loadedSvg(raster: FakeRaster): string {
  expect(raster.loadImage).toHaveBeenCalledTimes(1);

  return decodeSvgDataUrl(raster.loadImage.mock.calls[0][0] as string);
}

/* ---- The async Clipboard API. ---- */

interface ClipboardHarness {
  write: MockFunction;
  /* What each ClipboardItem was constructed with, in order. */
  entries: Array<Record<string, unknown>>;
  instances: Array<unknown>;
}

function installClipboard(options?: {
  write?: (items: Array<unknown>) => Promise<void>;
  itemThrows?: { error: unknown };
}): ClipboardHarness {
  const entries: Array<Record<string, unknown>> = [];
  const instances: Array<unknown> = [];
  const itemThrows: { error: unknown } | undefined = options?.itemThrows;
  const write: MockFunction = getJestMockFunction().mockImplementation(
    options?.write ??
      ((): Promise<void> => {
        return Promise.resolve();
      }),
  );

  class FakeClipboardItem {
    public readonly types: Array<string>;

    public constructor(items: Record<string, unknown>) {
      if (itemThrows) {
        throw itemThrows.error;
      }

      entries.push(items);
      instances.push(this);
      this.types = Object.keys(items);
    }
  }

  overrideProperty(window, "isSecureContext", true);
  overrideProperty(navigator, "clipboard", { write: write });
  overrideProperty(window, "ClipboardItem", FakeClipboardItem);

  return { write: write, entries: entries, instances: instances };
}

afterEach(() => {
  restoreOverrides();
  jest.useRealTimers();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("formatReplayScreenshotOffset", () => {
  it("writes the start of the recording as 0m00.0s", () => {
    expect(formatReplayScreenshotOffset(0)).toBe("0m00.0s");
  });

  it("keeps tenths of a second so shots a few frames apart do not collide", () => {
    expect(formatReplayScreenshotOffset(99)).toBe("0m00.0s");
    expect(formatReplayScreenshotOffset(100)).toBe("0m00.1s");
    expect(formatReplayScreenshotOffset(7300)).toBe("0m07.3s");
    expect(formatReplayScreenshotOffset(7400)).toBe("0m07.4s");
  });

  it("floors instead of rounding, so the name never runs ahead of the frame", () => {
    expect(formatReplayScreenshotOffset(7399)).toBe("0m07.3s");
    expect(formatReplayScreenshotOffset(7399.99)).toBe("0m07.3s");
    expect(formatReplayScreenshotOffset(0.5)).toBe("0m00.0s");
  });

  it("does not round 59.95s up into the next minute", () => {
    expect(formatReplayScreenshotOffset(59950)).toBe("0m59.9s");
    expect(formatReplayScreenshotOffset(59999)).toBe("0m59.9s");
    expect(formatReplayScreenshotOffset(60000)).toBe("1m00.0s");
  });

  it("counts whole minutes with zero-padded seconds", () => {
    expect(formatReplayScreenshotOffset(OFFSET_MS)).toBe("4m07.3s");
    expect(formatReplayScreenshotOffset(725000)).toBe("12m05.0s");
    expect(formatReplayScreenshotOffset(3599999)).toBe("59m59.9s");
  });

  it("adds hours with zero-padded minutes once past the hour", () => {
    expect(formatReplayScreenshotOffset(3600000)).toBe("1h00m00.0s");
    expect(formatReplayScreenshotOffset(3723400)).toBe("1h02m03.4s");
    expect(formatReplayScreenshotOffset(36000000)).toBe("10h00m00.0s");
    expect(formatReplayScreenshotOffset(26 * 3600000 + 5 * 60000)).toBe(
      "26h05m00.0s",
    );
  });

  it("treats negative, NaN and infinite offsets as the start", () => {
    const invalid: Array<number> = [
      -1,
      -60000,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];

    invalid.forEach((offsetMs: number): void => {
      expect(formatReplayScreenshotOffset(offsetMs)).toBe("0m00.0s");
    });
  });

  it("never contains a colon, which a Windows file name cannot", () => {
    [0, 999, 61234, 3723400, 99999999].forEach((offsetMs: number): void => {
      expect(formatReplayScreenshotOffset(offsetMs)).not.toContain(":");
    });
  });
});

describe("buildReplayScreenshotFileName", () => {
  it("names the file after the first eight characters of the session id and the playhead", () => {
    expect(
      buildReplayScreenshotFileName({
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
      }),
    ).toBe("session-replay-3f9a2c1b-4m07.3s.png");
  });

  it("lowercases the id and drops every character that is not a letter or digit", () => {
    expect(
      buildReplayScreenshotFileName({
        sessionId: "a1-B2_c3.D4/e5:f6",
        offsetMs: 0,
      }),
    ).toBe("session-replay-a1b2c3d4-0m00.0s.png");
    expect(
      buildReplayScreenshotFileName({
        sessionId: "ñandú-0123456789",
        offsetMs: 0,
      }),
    ).toBe("session-replay-and01234-0m00.0s.png");
  });

  it("keeps an id shorter than eight characters whole", () => {
    expect(
      buildReplayScreenshotFileName({ sessionId: "abc", offsetMs: 0 }),
    ).toBe("session-replay-abc-0m00.0s.png");
  });

  it("falls back to 'session' when the id has nothing usable", () => {
    const ids: Array<string> = ["", "----___", "日本語", " "];

    ids.forEach((sessionId: string): void => {
      expect(buildReplayScreenshotFileName({ sessionId, offsetMs: 0 })).toBe(
        "session-replay-session-0m00.0s.png",
      );
    });

    expect(
      buildReplayScreenshotFileName({
        sessionId: undefined as unknown as string,
        offsetMs: 0,
      }),
    ).toBe("session-replay-session-0m00.0s.png");
  });

  it("adds the tab as a slug only when a label is given", () => {
    expect(
      buildReplayScreenshotFileName({
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        tabLabel: "Tab 2",
      }),
    ).toBe("session-replay-3f9a2c1b-tab-2-4m07.3s.png");

    [null, undefined, ""].forEach(
      (tabLabel: string | null | undefined): void => {
        expect(
          buildReplayScreenshotFileName({
            sessionId: SESSION_ID,
            offsetMs: OFFSET_MS,
            tabLabel: tabLabel,
          }),
        ).toBe("session-replay-3f9a2c1b-4m07.3s.png");
      },
    );
  });

  it("slugs awkward labels to lowercase words joined by single dashes", () => {
    const cases: Array<[string, string]> = [
      ["  Tab   #3!! ", "tab-3"],
      ["Checkout / Payment", "checkout-payment"],
      ["C:\\Users\\alice\\evil", "c-users-alice-evil"],
      ["../../etc/passwd", "etc-passwd"],
      ["ÄÖÜ tab", "tab"],
      ["TAB_7", "tab-7"],
    ];

    cases.forEach(([tabLabel, slug]: [string, string]): void => {
      expect(
        buildReplayScreenshotFileName({
          sessionId: SESSION_ID,
          offsetMs: 0,
          tabLabel: tabLabel,
        }),
      ).toBe(`session-replay-3f9a2c1b-${slug}-0m00.0s.png`);
    });
  });

  it("leaves the tab out when the label slugs to nothing", () => {
    ["🙂🙂", "---", "   ", "***"].forEach((tabLabel: string): void => {
      expect(
        buildReplayScreenshotFileName({
          sessionId: SESSION_ID,
          offsetMs: 0,
          tabLabel: tabLabel,
        }),
      ).toBe("session-replay-3f9a2c1b-0m00.0s.png");
    });
  });

  it("caps a long label at 24 characters", () => {
    expect(
      buildReplayScreenshotFileName({
        sessionId: SESSION_ID,
        offsetMs: 0,
        tabLabel: "abcdefghijklmnopqrstuvwxyzabcdefghijklmn",
      }),
    ).toBe("session-replay-3f9a2c1b-abcdefghijklmnopqrstuvwx-0m00.0s.png");
  });

  it("never leaves a dangling dash where a long label is cut", () => {
    const name: string = buildReplayScreenshotFileName({
      sessionId: SESSION_ID,
      offsetMs: 0,
      tabLabel: `${"a".repeat(23)} b`,
    });

    expect(name).toBe(`session-replay-3f9a2c1b-${"a".repeat(23)}-0m00.0s.png`);
    expect(name).not.toContain("--");
  });

  it("always ends in .png and never holds a character a file system refuses", () => {
    const labels: Array<string | null> = [
      null,
      "Tab 2",
      'a<b>c:d"e/f\\g|h?i*j',
      "\u0000\u001f control",
      "trailing dot.",
      "  spaced  ",
    ];
    const ids: Array<string> = [SESSION_ID, "", 'x:y*z?"<>|', "\u0007bell"];
    const offsets: Array<number> = [0, 7399, 3723400, Number.NaN, -5];

    ids.forEach((sessionId: string): void => {
      labels.forEach((tabLabel: string | null): void => {
        offsets.forEach((offsetMs: number): void => {
          const name: string = buildReplayScreenshotFileName({
            sessionId: sessionId,
            offsetMs: offsetMs,
            tabLabel: tabLabel,
          });

          expect(name.endsWith(".png")).toBe(true);
          expect(SAFE_FILE_NAME_PATTERN.test(name)).toBe(true);
          WINDOWS_RESERVED_CHARACTERS.forEach((character: string): void => {
            expect(name).not.toContain(character);
          });
          Array.from(name).forEach((character: string): void => {
            expect(character.charCodeAt(0)).toBeGreaterThanOrEqual(32);
          });
        });
      });
    });
  });
});

describe("readReplayViewport", () => {
  it("reads the recorded size from the width and height attributes", () => {
    const iframe: HTMLIFrameElement = document.createElement("iframe");

    iframe.setAttribute("width", "1440");
    iframe.setAttribute("height", "900");

    expect(readReplayViewport(iframe)).toEqual({ width: 1440, height: 900 });
  });

  it("prefers the attributes over the scaled client box", () => {
    const iframe: HTMLIFrameElement = document.createElement("iframe");

    iframe.setAttribute("width", "1440");
    iframe.setAttribute("height", "900");
    sizeElement(iframe, { client: [720, 450] });

    expect(readReplayViewport(iframe)).toEqual({ width: 1440, height: 900 });
  });

  it("keeps a fractional attribute as it is", () => {
    const iframe: HTMLIFrameElement = document.createElement("iframe");

    iframe.setAttribute("width", "390.5");
    iframe.setAttribute("height", " 844 ");

    expect(readReplayViewport(iframe)).toEqual({ width: 390.5, height: 844 });
  });

  it("falls back to clientWidth and clientHeight when the attributes are missing", () => {
    const iframe: HTMLIFrameElement = document.createElement("iframe");

    sizeElement(iframe, { client: [1024, 768] });

    expect(readReplayViewport(iframe)).toEqual({ width: 1024, height: 768 });
  });

  it("falls back per axis when only one attribute is usable", () => {
    const iframe: HTMLIFrameElement = document.createElement("iframe");

    iframe.setAttribute("width", "1280");
    iframe.setAttribute("height", "0");
    sizeElement(iframe, { client: [640, 360] });

    expect(readReplayViewport(iframe)).toEqual({ width: 1280, height: 360 });
  });

  it("ignores zero, negative, empty, infinite and non-numeric attributes", () => {
    ["0", "-800", "", "Infinity", "800px", "wide", "NaN"].forEach(
      (value: string): void => {
        const iframe: HTMLIFrameElement = document.createElement("iframe");

        iframe.setAttribute("width", value);
        iframe.setAttribute("height", value);
        sizeElement(iframe, { client: [300, 200] });

        expect(readReplayViewport(iframe)).toEqual({ width: 300, height: 200 });
      },
    );
  });

  it("returns null when neither the attributes nor the client box has a size", () => {
    const unsized: HTMLIFrameElement = document.createElement("iframe");

    expect(readReplayViewport(unsized)).toBeNull();

    const zeroed: HTMLIFrameElement = document.createElement("iframe");

    zeroed.setAttribute("width", "0");
    zeroed.setAttribute("height", "0");
    sizeElement(zeroed, { client: [0, 0] });

    expect(readReplayViewport(zeroed)).toBeNull();
  });

  it("returns null when only one axis has a size", () => {
    const widthOnly: HTMLIFrameElement = document.createElement("iframe");

    widthOnly.setAttribute("width", "800");

    expect(readReplayViewport(widthOnly)).toBeNull();

    const heightOnly: HTMLIFrameElement = document.createElement("iframe");

    sizeElement(heightOnly, { client: [0, 600] });

    expect(readReplayViewport(heightOnly)).toBeNull();
  });
});

describe("readReplayPointer", () => {
  function makeWrapper(): HTMLElement {
    const wrapper: HTMLElement = document.createElement("div");

    document.body.appendChild(wrapper);

    return wrapper;
  }

  it("returns null when the stage has no pointer element", () => {
    expect(readReplayPointer(makeWrapper())).toBeNull();
  });

  it("returns null for a pointer that has not been placed yet", () => {
    const noLeft: HTMLElement = makeWrapper();

    addPointer(noLeft, { left: "", size: [20, 20] });

    expect(readReplayPointer(noLeft)).toBeNull();

    const noTop: HTMLElement = makeWrapper();

    addPointer(noTop, { top: "", size: [20, 20] });

    expect(readReplayPointer(noTop)).toBeNull();
  });

  it("returns null for a pointer the stage hides with display none", () => {
    const wrapper: HTMLElement = makeWrapper();
    const pointer: HTMLElement = addPointer(wrapper, { size: [20, 20] });

    pointer.style.display = "none";

    expect(readReplayPointer(wrapper)).toBeNull();
  });

  it("returns null for a pointer hidden by a stylesheet rule", () => {
    const style: HTMLStyleElement = document.createElement("style");

    style.textContent = ".replayer-mouse.hidden-cursor { display: none; }";
    document.head.appendChild(style);

    const wrapper: HTMLElement = makeWrapper();
    const pointer: HTMLElement = addPointer(wrapper, { size: [20, 20] });

    pointer.classList.add("hidden-cursor");

    expect(readReplayPointer(wrapper)).toBeNull();
  });

  it("returns null for a pointer with visibility hidden, its own or inherited", () => {
    const own: HTMLElement = makeWrapper();

    addPointer(own, { size: [20, 20] }).style.visibility = "hidden";

    expect(readReplayPointer(own)).toBeNull();

    const inherited: HTMLElement = makeWrapper();

    inherited.style.visibility = "hidden";
    addPointer(inherited, { size: [20, 20] });

    expect(readReplayPointer(inherited)).toBeNull();
  });

  /*
   * The stage draws the dot for a touch recording too - at the last tap -
   * so the screenshot keeps it.
   */
  it("keeps a touch recording's pointer at the last tap", () => {
    const wrapper: HTMLElement = makeWrapper();

    addPointer(wrapper, { size: [20, 20] }).classList.add("touch-device");

    expect(readReplayPointer(wrapper)).toEqual({ x: 110, y: 60 });
  });

  it("returns null for a pointer in a document with no window", () => {
    const inert: Document = document.implementation.createHTMLDocument("");
    const wrapper: HTMLElement = inert.createElement("div");

    inert.body.appendChild(wrapper);
    addPointer(wrapper, { size: [20, 20] });

    expect(readReplayPointer(wrapper)).toBeNull();
  });

  it("returns null when left or top is not a number", () => {
    const wrapper: HTMLElement = makeWrapper();

    addPointer(wrapper, { left: "auto", size: [20, 20] });

    expect(readReplayPointer(wrapper)).toBeNull();

    const topAuto: HTMLElement = makeWrapper();

    addPointer(topAuto, { top: "auto", size: [20, 20] });

    expect(readReplayPointer(topAuto)).toBeNull();
  });

  it("returns the centre of the dot: its corner plus half its laid-out box", () => {
    const wrapper: HTMLElement = makeWrapper();

    addPointer(wrapper, { left: "100px", top: "50px", size: [20, 20] });

    expect(readReplayPointer(wrapper)).toEqual({ x: 110, y: 60 });
  });

  it("uses the offset box even when the computed width says otherwise", () => {
    const wrapper: HTMLElement = makeWrapper();
    const pointer: HTMLElement = addPointer(wrapper, {
      left: "100px",
      top: "50px",
      size: [30, 10],
    });

    pointer.style.width = "80px";
    pointer.style.height = "80px";

    expect(readReplayPointer(wrapper)).toEqual({ x: 115, y: 55 });
  });

  it("adds the pointer's margins", () => {
    const wrapper: HTMLElement = makeWrapper();
    const pointer: HTMLElement = addPointer(wrapper, {
      left: "100px",
      top: "50px",
      size: [20, 20],
    });

    pointer.style.marginLeft = "-10px";
    pointer.style.marginTop = "-4px";

    expect(readReplayPointer(wrapper)).toEqual({ x: 100, y: 56 });
  });

  it("falls back to the computed width and height when there is no layout", () => {
    const wrapper: HTMLElement = makeWrapper();
    const pointer: HTMLElement = addPointer(wrapper, {
      left: "100px",
      top: "50px",
    });

    pointer.style.width = "24px";
    pointer.style.height = "16px";

    expect(readReplayPointer(wrapper)).toEqual({ x: 112, y: 58 });
  });

  it("reads the stage stylesheet's 20px dot when nothing is inline", () => {
    const style: HTMLStyleElement = document.createElement("style");

    style.textContent =
      ".replayer-wrapper .replayer-mouse { position: absolute; width: 20px; height: 20px; }";
    document.head.appendChild(style);

    const wrapper: HTMLElement = makeWrapper();

    wrapper.className = "replayer-wrapper";
    addPointer(wrapper, { left: "640.5px", top: "12px" });

    expect(readReplayPointer(wrapper)).toEqual({ x: 650.5, y: 22 });
  });

  it("returns the corner itself when the dot has no size at all", () => {
    const wrapper: HTMLElement = makeWrapper();

    addPointer(wrapper, { left: "7px", top: "9px" });

    expect(readReplayPointer(wrapper)).toEqual({ x: 7, y: 9 });
  });

  it("finds the pointer anywhere inside the wrapper", () => {
    const wrapper: HTMLElement = makeWrapper();
    const layer: HTMLElement = document.createElement("div");

    wrapper.appendChild(layer);
    addPointer(layer, { left: "0px", top: "0px", size: [20, 20] });

    const pointer: ReplayFramePointer | null = readReplayPointer(wrapper);

    expect(pointer).toEqual({ x: 10, y: 10 });
  });
});

describe("captureReplayerScreenshot", () => {
  it("rejects with no-document when there is no Replayer yet", async () => {
    const raster: FakeRaster = makeRaster();
    const pending: Promise<ReplayScreenshot> = captureReplayerScreenshot({
      replayer: null,
      sessionId: SESSION_ID,
      offsetMs: OFFSET_MS,
      deps: raster.deps,
    });
    const error: unknown = await catchRejection(pending);

    expect(error).toBeInstanceOf(ReplayFrameCaptureError);
    expect((error as ReplayFrameCaptureError).reason).toBe("no-document");
    expect((error as ReplayFrameCaptureError).name).toBe(
      "ReplayFrameCaptureError",
    );
    expect(raster.createCanvas).not.toHaveBeenCalled();
  });

  it("rejects with no-document when the iframe has no document", async () => {
    const wrapper: HTMLElement = document.createElement("div");
    const detached: HTMLIFrameElement = document.createElement("iframe");

    detached.setAttribute("width", "800");
    detached.setAttribute("height", "600");
    wrapper.appendChild(detached);

    expect(detached.contentDocument).toBeNull();

    const error: unknown = await catchRejection(
      captureReplayerScreenshot({
        replayer: makeReplayerLike(detached, wrapper),
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        deps: makeRaster().deps,
      }),
    );

    expect(error).toBeInstanceOf(ReplayFrameCaptureError);
    expect((error as ReplayFrameCaptureError).reason).toBe("no-document");
  });

  it("rejects with no-document when reading the document throws", async () => {
    const fixture: ReplayerFixture = makeReplayer();

    defineGetter(fixture.iframe, "contentDocument", (): never => {
      throw new DOMException("Blocked a frame", "SecurityError");
    });

    const error: unknown = await catchRejection(
      captureReplayerScreenshot({
        replayer: fixture.replayer,
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        deps: makeRaster().deps,
      }),
    );

    expect(error).toBeInstanceOf(ReplayFrameCaptureError);
    expect((error as ReplayFrameCaptureError).reason).toBe("no-document");
  });

  it("rejects with no-document when the document has no root element", async () => {
    const fixture: ReplayerFixture = makeReplayer();

    fixture.replayDocument.removeChild(fixture.replayDocument.documentElement);

    const error: unknown = await catchRejection(
      captureReplayerScreenshot({
        replayer: fixture.replayer,
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        deps: makeRaster().deps,
      }),
    );

    expect((error as ReplayFrameCaptureError).reason).toBe("no-document");
  });

  it("rejects with empty-viewport when the recorded size is unknown", async () => {
    const fixture: ReplayerFixture = makeReplayer({
      width: null,
      height: null,
    });
    const raster: FakeRaster = makeRaster();
    const error: unknown = await catchRejection(
      captureReplayerScreenshot({
        replayer: fixture.replayer,
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        deps: raster.deps,
      }),
    );

    expect(error).toBeInstanceOf(ReplayFrameCaptureError);
    expect((error as ReplayFrameCaptureError).reason).toBe("empty-viewport");
    expect(raster.createCanvas).not.toHaveBeenCalled();
    expect(raster.loadImage).not.toHaveBeenCalled();
  });

  it("rejects with empty-viewport when one axis is zero", async () => {
    const fixture: ReplayerFixture = makeReplayer({ height: "0" });
    const error: unknown = await catchRejection(
      captureReplayerScreenshot({
        replayer: fixture.replayer,
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        deps: makeRaster().deps,
      }),
    );

    expect((error as ReplayFrameCaptureError).reason).toBe("empty-viewport");
  });

  it("resolves the encoded PNG with the file name and the recorded size", async () => {
    const fixture: ReplayerFixture = makeReplayer();
    const raster: FakeRaster = makeRaster();
    const screenshot: ReplayScreenshot = await captureReplayerScreenshot({
      replayer: fixture.replayer,
      sessionId: SESSION_ID,
      offsetMs: OFFSET_MS,
      tabLabel: "Tab 2",
      pixelRatio: 2,
      deps: raster.deps,
    });

    expect(screenshot.blob).toBe(raster.blob);
    expect(screenshot.fileName).toBe(
      "session-replay-3f9a2c1b-tab-2-4m07.3s.png",
    );
    expect(screenshot.fileName).toBe(
      buildReplayScreenshotFileName({
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        tabLabel: "Tab 2",
      }),
    );
    /* CSS pixels, however dense the PNG. */
    expect(screenshot.width).toBe(800);
    expect(screenshot.height).toBe(600);
    expect(raster.createCanvas).toHaveBeenCalledWith(1600, 1200);
    expect(raster.toBlob).toHaveBeenCalledTimes(1);
    expect(raster.toBlob.mock.calls[0][1]).toBe("image/png");
  });

  it("leaves the tab out of the name for a single-tab session", async () => {
    const fixture: ReplayerFixture = makeReplayer();
    const screenshot: ReplayScreenshot = await captureReplayerScreenshot({
      replayer: fixture.replayer,
      sessionId: SESSION_ID,
      offsetMs: 0,
      tabLabel: null,
      deps: makeRaster().deps,
    });

    expect(screenshot.fileName).toBe("session-replay-3f9a2c1b-0m00.0s.png");
  });

  it("draws the replay document itself, through the injected raster deps", async () => {
    const fixture: ReplayerFixture = makeReplayer();
    const raster: FakeRaster = makeRaster();

    await captureReplayerScreenshot({
      replayer: fixture.replayer,
      sessionId: SESSION_ID,
      offsetMs: OFFSET_MS,
      pixelRatio: 1,
      deps: raster.deps,
    });

    const svg: string = loadedSvg(raster);

    expect(svg).toContain("<foreignObject");
    expect(svg).toContain('width="800"');
    expect(svg).toContain('height="600"');
    expect(svg).toContain("Checkout");
    expect(svg).toContain("Total: $42");
    expect(raster.nextFrame).toHaveBeenCalled();
    expect(raster.drawImage).toHaveBeenCalled();
  });

  it("clones the document before it returns, so later playback cannot change the picture", async () => {
    const fixture: ReplayerFixture = makeReplayer();
    const raster: FakeRaster = makeRaster();
    const pending: Promise<ReplayScreenshot> = captureReplayerScreenshot({
      replayer: fixture.replayer,
      sessionId: SESSION_ID,
      offsetMs: OFFSET_MS,
      deps: raster.deps,
    });

    fixture.replayDocument.body.innerHTML = "<p>Order confirmed</p>";
    await pending;

    const svg: string = loadedSvg(raster);

    expect(svg).toContain("Checkout");
    expect(svg).not.toContain("Order confirmed");
  });

  it("never writes to the live replay document", async () => {
    const fixture: ReplayerFixture = makeReplayer();
    const input: HTMLInputElement | null =
      fixture.replayDocument.querySelector("#email");

    if (!input) {
      throw new Error("fixture has no input");
    }

    input.value = "typed@example.com";

    const view: (Window & typeof globalThis) | null = fixture.replayDocument
      .defaultView as (Window & typeof globalThis) | null;

    if (!view) {
      throw new Error("the replay document has no window");
    }

    const before: string = fixture.replayDocument.documentElement.outerHTML;
    const observer: MutationObserver = new view.MutationObserver((): void => {
      // Records are read with takeRecords below.
    });

    observer.observe(fixture.replayDocument, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });

    await captureReplayerScreenshot({
      replayer: fixture.replayer,
      sessionId: SESSION_ID,
      offsetMs: OFFSET_MS,
      deps: makeRaster().deps,
    });

    const records: Array<MutationRecord> = observer.takeRecords();

    observer.disconnect();

    expect(records).toHaveLength(0);
    expect(fixture.replayDocument.documentElement.outerHTML).toBe(before);
    expect(input.getAttribute("value")).toBeNull();
    expect(input.value).toBe("typed@example.com");
  });

  describe("pixel ratio", () => {
    it("uses window.devicePixelRatio when none is given", async () => {
      overrideProperty(window, "devicePixelRatio", 1.5);

      const raster: FakeRaster = makeRaster();

      await captureReplayerScreenshot({
        replayer: makeReplayer().replayer,
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        deps: raster.deps,
      });

      expect(raster.createCanvas).toHaveBeenCalledWith(1200, 900);
    });

    it("prefers an explicit pixel ratio over the display's", async () => {
      overrideProperty(window, "devicePixelRatio", 2);

      const raster: FakeRaster = makeRaster();

      await captureReplayerScreenshot({
        replayer: makeReplayer().replayer,
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        pixelRatio: 1,
        deps: raster.deps,
      });

      expect(raster.createCanvas).toHaveBeenCalledWith(800, 600);
    });

    it("draws at 1x when the display reports no usable ratio", async () => {
      overrideProperty(window, "devicePixelRatio", 0);

      const raster: FakeRaster = makeRaster();

      await captureReplayerScreenshot({
        replayer: makeReplayer().replayer,
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        deps: raster.deps,
      });

      expect(raster.createCanvas).toHaveBeenCalledWith(800, 600);
    });

    it("caps a 3x display at a 2x PNG", async () => {
      overrideProperty(window, "devicePixelRatio", 3);

      const raster: FakeRaster = makeRaster();
      const screenshot: ReplayScreenshot = await captureReplayerScreenshot({
        replayer: makeReplayer().replayer,
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        deps: raster.deps,
      });

      expect(raster.createCanvas).toHaveBeenCalledWith(1600, 1200);
      expect(screenshot.width).toBe(800);
    });
  });

  describe("the stage pointer", () => {
    it("draws the pointer read from the Replayer's wrapper, scaled with the PNG", async () => {
      const fixture: ReplayerFixture = makeReplayer();
      const raster: FakeRaster = makeRaster();

      addPointer(fixture.wrapper, {
        left: "100px",
        top: "50px",
        size: [20, 20],
      });

      await captureReplayerScreenshot({
        replayer: fixture.replayer,
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        pixelRatio: 2,
        deps: raster.deps,
      });

      expect(raster.arc).toHaveBeenCalledTimes(1);
      expect(raster.arc).toHaveBeenCalledWith(220, 120, 20, 0, Math.PI * 2);
    });

    it("draws no pointer when the stage has none", async () => {
      const raster: FakeRaster = makeRaster();

      await captureReplayerScreenshot({
        replayer: makeReplayer().replayer,
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        deps: raster.deps,
      });

      expect(raster.arc).not.toHaveBeenCalled();
    });

    it("draws the tap dot of a touch recording, as the stage does", async () => {
      const fixture: ReplayerFixture = makeReplayer();
      const raster: FakeRaster = makeRaster();

      addPointer(fixture.wrapper, { size: [20, 20] }).classList.add(
        "touch-device",
      );

      await captureReplayerScreenshot({
        replayer: fixture.replayer,
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        pixelRatio: 2,
        deps: raster.deps,
      });

      expect(raster.arc).toHaveBeenCalledTimes(1);
      expect(raster.arc).toHaveBeenCalledWith(220, 120, 20, 0, Math.PI * 2);
    });

    it("draws no pointer that sits outside the recorded viewport", async () => {
      const fixture: ReplayerFixture = makeReplayer();
      const raster: FakeRaster = makeRaster();

      addPointer(fixture.wrapper, {
        left: "5000px",
        top: "50px",
        size: [20, 20],
      });

      await captureReplayerScreenshot({
        replayer: fixture.replayer,
        sessionId: SESSION_ID,
        offsetMs: OFFSET_MS,
        deps: raster.deps,
      });

      expect(raster.arc).not.toHaveBeenCalled();
    });
  });

  describe("raster failures", () => {
    it("rejects with render-failed when the image cannot be drawn", async () => {
      const raster: FakeRaster = makeRaster({
        loadImage: (): Promise<CanvasImageSource> => {
          return Promise.reject(new Error("image decode failed"));
        },
      });
      const error: unknown = await catchRejection(
        captureReplayerScreenshot({
          replayer: makeReplayer().replayer,
          sessionId: SESSION_ID,
          offsetMs: OFFSET_MS,
          deps: raster.deps,
        }),
      );

      expect(error).toBeInstanceOf(ReplayFrameCaptureError);
      expect((error as ReplayFrameCaptureError).reason).toBe("render-failed");
    });

    it("rejects with render-failed when there is no 2D canvas", async () => {
      const error: unknown = await catchRejection(
        captureReplayerScreenshot({
          replayer: makeReplayer().replayer,
          sessionId: SESSION_ID,
          offsetMs: OFFSET_MS,
          deps: makeRaster({ hasContext: false }).deps,
        }),
      );

      expect((error as ReplayFrameCaptureError).reason).toBe("render-failed");
    });

    it("rejects with encode-failed when the canvas yields no PNG", async () => {
      const error: unknown = await catchRejection(
        captureReplayerScreenshot({
          replayer: makeReplayer().replayer,
          sessionId: SESSION_ID,
          offsetMs: OFFSET_MS,
          deps: makeRaster({ blob: null }).deps,
        }),
      );

      expect(error).toBeInstanceOf(ReplayFrameCaptureError);
      expect((error as ReplayFrameCaptureError).reason).toBe("encode-failed");
    });
  });

  it("keeps the default for any raster dep a test leaves out", async () => {
    const raster: FakeRaster = makeRaster();
    const screenshot: ReplayScreenshot = await captureReplayerScreenshot({
      replayer: makeReplayer().replayer,
      sessionId: SESSION_ID,
      offsetMs: OFFSET_MS,
      pixelRatio: 1,
      deps: {
        createCanvas: raster.deps.createCanvas,
        loadImage: raster.deps.loadImage,
      },
    });

    expect(screenshot.blob).toBe(raster.blob);
    expect(raster.nextFrame).not.toHaveBeenCalled();
  });
});

describe("getReplayImageClipboardSupport", () => {
  it("reports insecure-context on a plain-http page, whatever else is there", () => {
    installClipboard();
    overrideProperty(window, "isSecureContext", false);

    expect(getReplayImageClipboardSupport()).toBe("insecure-context");

    overrideProperty(navigator, "clipboard", undefined);

    expect(getReplayImageClipboardSupport()).toBe("insecure-context");
  });

  it("reports unsupported without navigator.clipboard", () => {
    installClipboard();
    overrideProperty(navigator, "clipboard", undefined);

    expect(getReplayImageClipboardSupport()).toBe("unsupported");
  });

  it("reports unsupported for a text-only clipboard", () => {
    installClipboard();
    overrideProperty(navigator, "clipboard", {
      writeText: getJestMockFunction(),
    });

    expect(getReplayImageClipboardSupport()).toBe("unsupported");

    overrideProperty(navigator, "clipboard", { write: "not a function" });

    expect(getReplayImageClipboardSupport()).toBe("unsupported");
  });

  it("reports unsupported without ClipboardItem", () => {
    installClipboard();
    overrideProperty(window, "ClipboardItem", undefined);

    expect(getReplayImageClipboardSupport()).toBe("unsupported");
  });

  it("reports supported when the secure page has clipboard.write and ClipboardItem", () => {
    installClipboard();

    expect(getReplayImageClipboardSupport()).toBe("supported");
  });

  it("only treats an explicit isSecureContext false as insecure", () => {
    installClipboard();
    overrideProperty(window, "isSecureContext", undefined);

    expect(getReplayImageClipboardSupport()).toBe("supported");
  });

  it("reports unsupported in jsdom's own environment, which has no clipboard", () => {
    expect(getReplayImageClipboardSupport()).toBe("unsupported");
  });
});

describe("copyReplayScreenshotToClipboard", () => {
  describe("when the browser cannot copy images", () => {
    it("rejects with unsupported and never touches the clipboard", async () => {
      const harness: ClipboardHarness = installClipboard();

      overrideProperty(window, "ClipboardItem", undefined);

      const error: unknown = await catchRejection(
        copyReplayScreenshotToClipboard(Promise.resolve(makePng())),
      );

      expect(error).toBeInstanceOf(ReplayScreenshotClipboardError);
      expect((error as ReplayScreenshotClipboardError).reason).toBe(
        "unsupported",
      );
      expect((error as ReplayScreenshotClipboardError).name).toBe(
        "ReplayScreenshotClipboardError",
      );
      expect(harness.write).not.toHaveBeenCalled();
    });

    it("rejects with insecure-context on a plain-http page", async () => {
      const harness: ClipboardHarness = installClipboard();

      overrideProperty(window, "isSecureContext", false);

      const error: unknown = await catchRejection(
        copyReplayScreenshotToClipboard(Promise.resolve(makePng())),
      );

      expect((error as ReplayScreenshotClipboardError).reason).toBe(
        "insecure-context",
      );
      expect((error as Error).message).toContain("https");
      expect(harness.write).not.toHaveBeenCalled();
      expect(harness.instances).toHaveLength(0);
    });

    it("does not leave a later capture failure unhandled", async () => {
      overrideProperty(window, "isSecureContext", false);

      const image: Deferred<Blob> = makeDeferred<Blob>();
      const error: unknown = await catchRejection(
        copyReplayScreenshotToClipboard(image.promise),
      );

      expect((error as ReplayScreenshotClipboardError).reason).toBe(
        "insecure-context",
      );

      image.reject(
        new ReplayFrameCaptureError("render-failed", "could not draw"),
      );
      await flushRejectionTracking();
    });

    it("does not leave a later capture failure unhandled when unsupported", async () => {
      const image: Deferred<Blob> = makeDeferred<Blob>();
      const error: unknown = await catchRejection(
        copyReplayScreenshotToClipboard(image.promise),
      );

      expect((error as ReplayScreenshotClipboardError).reason).toBe(
        "unsupported",
      );

      image.reject(
        new ReplayFrameCaptureError("encode-failed", "could not encode"),
      );
      await flushRejectionTracking();
    });
  });

  it("builds the ClipboardItem and starts the write synchronously, with the PENDING image", async () => {
    const harness: ClipboardHarness = installClipboard();
    const image: Deferred<Blob> = makeDeferred<Blob>();
    let wasPendingAtWrite: boolean | null = null;

    harness.write.mockImplementation((): Promise<void> => {
      wasPendingAtWrite = !image.isSettled();

      return Promise.resolve();
    });

    const copied: Promise<void> = copyReplayScreenshotToClipboard(
      image.promise,
    );

    /* Nothing has been awaited yet: this is still inside the click. */
    expect(harness.instances).toHaveLength(1);
    expect(Object.keys(harness.entries[0] as Record<string, unknown>)).toEqual([
      "image/png",
    ]);
    expect((harness.entries[0] as Record<string, unknown>)["image/png"]).toBe(
      image.promise,
    );
    expect(harness.write).toHaveBeenCalledTimes(1);

    const written: Array<unknown> = harness.write.mock
      .calls[0][0] as Array<unknown>;

    expect(written).toHaveLength(1);
    expect(written[0]).toBe(harness.instances[0]);
    expect(wasPendingAtWrite).toBe(true);
    expect(image.isSettled()).toBe(false);

    image.resolve(makePng());

    await expect(copied).resolves.toBeUndefined();
  });

  it("resolves only once both the image and the write have settled", async () => {
    const image: Deferred<Blob> = makeDeferred<Blob>();
    const write: Deferred<void> = makeDeferred<void>();

    installClipboard({
      write: (): Promise<void> => {
        return write.promise;
      },
    });

    let isDone: boolean = false;
    const copied: Promise<void> = copyReplayScreenshotToClipboard(
      image.promise,
    ).then((): void => {
      isDone = true;
    });

    image.resolve(makePng());
    await flushRejectionTracking();

    expect(isDone).toBe(false);

    write.resolve();
    await copied;

    expect(isDone).toBe(true);
  });

  it("waits for the image even when the write settles first", async () => {
    const image: Deferred<Blob> = makeDeferred<Blob>();

    installClipboard();

    let isDone: boolean = false;
    const copied: Promise<void> = copyReplayScreenshotToClipboard(
      image.promise,
    ).then((): void => {
      isDone = true;
    });

    await flushRejectionTracking();

    expect(isDone).toBe(false);

    image.resolve(makePng());
    await copied;

    expect(isDone).toBe(true);
  });

  describe("a failed capture wins over the clipboard's complaint", () => {
    it("rejects with the capture error when the write also rejects afterwards", async () => {
      const image: Deferred<Blob> = makeDeferred<Blob>();
      const write: Deferred<void> = makeDeferred<void>();
      const captureError: ReplayFrameCaptureError = new ReplayFrameCaptureError(
        "render-failed",
        "The browser could not draw this frame.",
      );

      installClipboard({
        write: (): Promise<void> => {
          return write.promise;
        },
      });

      const copied: Promise<void> = copyReplayScreenshotToClipboard(
        image.promise,
      );

      image.reject(captureError);
      write.reject(new DOMException("rejected promise", "NotAllowedError"));

      expect(await catchRejection(copied)).toBe(captureError);
      await flushRejectionTracking();
    });

    it("rejects with the capture error when the write rejected first", async () => {
      const image: Deferred<Blob> = makeDeferred<Blob>();
      const captureError: ReplayFrameCaptureError = new ReplayFrameCaptureError(
        "encode-failed",
        "The frame could not be encoded as a PNG.",
      );

      installClipboard({
        write: (): Promise<void> => {
          return Promise.reject(new DOMException("no", "DataError"));
        },
      });

      const copied: Promise<void> = copyReplayScreenshotToClipboard(
        image.promise,
      );

      /* The write's rejection sits unawaited while the capture runs. */
      await flushRejectionTracking();
      image.reject(captureError);

      expect(await catchRejection(copied)).toBe(captureError);
      await flushRejectionTracking();
    });

    it("rejects with the capture error even when the write resolved", async () => {
      const image: Deferred<Blob> = makeDeferred<Blob>();
      const captureError: ReplayFrameCaptureError = new ReplayFrameCaptureError(
        "no-document",
        "The replay has not drawn a frame yet.",
      );

      installClipboard();

      const copied: Promise<void> = copyReplayScreenshotToClipboard(
        image.promise,
      );

      image.reject(captureError);

      expect(await catchRejection(copied)).toBe(captureError);
    });
  });

  describe("clipboard failures", () => {
    const cases: Array<[string, unknown, ReplayClipboardFailure]> = [
      [
        "a NotAllowedError DOMException",
        new DOMException("Write permission denied.", "NotAllowedError"),
        "denied",
      ],
      [
        "a NotAllowedError-shaped object",
        { name: "NotAllowedError", message: "Document is not focused." },
        "denied",
      ],
      [
        "a SecurityError",
        new DOMException("Blocked", "SecurityError"),
        "denied",
      ],
      [
        "a NotSupportedError",
        new DOMException("Type image/png not supported", "NotSupportedError"),
        "unsupported",
      ],
      ["a DataError", { name: "DataError" }, "unsupported"],
      ["an AbortError", new DOMException("Aborted", "AbortError"), "failed"],
      ["a TypeError", new TypeError("Failed to execute 'write'"), "failed"],
      ["a wrongly-cased name", { name: "notallowederror" }, "failed"],
      ["a non-string name", { name: 42 }, "failed"],
      ["a bare string", "denied", "failed"],
      ["null", null, "failed"],
      ["undefined", undefined, "failed"],
    ];

    cases.forEach(
      ([label, rejection, reason]: [
        string,
        unknown,
        ReplayClipboardFailure,
      ]): void => {
        it(`maps a write rejected with ${label} to ${reason}`, async () => {
          installClipboard({
            write: (): Promise<void> => {
              return Promise.reject(rejection);
            },
          });

          const error: unknown = await catchRejection(
            copyReplayScreenshotToClipboard(Promise.resolve(makePng())),
          );

          expect(error).toBeInstanceOf(ReplayScreenshotClipboardError);
          expect((error as ReplayScreenshotClipboardError).reason).toBe(reason);
          expect((error as Error).message.length).toBeGreaterThan(0);
        });
      },
    );

    it("maps a write that throws synchronously", async () => {
      installClipboard({
        write: (): Promise<void> => {
          throw new DOMException("Not focused", "NotAllowedError");
        },
      });

      const image: Deferred<Blob> = makeDeferred<Blob>();
      const error: unknown = await catchRejection(
        copyReplayScreenshotToClipboard(image.promise),
      );

      expect((error as ReplayScreenshotClipboardError).reason).toBe("denied");

      image.reject(new ReplayFrameCaptureError("render-failed", "late"));
      await flushRejectionTracking();
    });

    it("maps a ClipboardItem constructor that throws, without writing", async () => {
      const harness: ClipboardHarness = installClipboard({
        itemThrows: {
          error: new DOMException(
            "Promises are not supported",
            "NotSupportedError",
          ),
        },
      });
      const image: Deferred<Blob> = makeDeferred<Blob>();
      const error: unknown = await catchRejection(
        copyReplayScreenshotToClipboard(image.promise),
      );

      expect(error).toBeInstanceOf(ReplayScreenshotClipboardError);
      expect((error as ReplayScreenshotClipboardError).reason).toBe(
        "unsupported",
      );
      expect(harness.write).not.toHaveBeenCalled();

      image.reject(new ReplayFrameCaptureError("render-failed", "late"));
      await flushRejectionTracking();
    });

    it("maps a ClipboardItem constructor TypeError to failed", async () => {
      installClipboard({
        itemThrows: { error: new TypeError("Illegal constructor") },
      });

      const error: unknown = await catchRejection(
        copyReplayScreenshotToClipboard(Promise.resolve(makePng())),
      );

      expect((error as ReplayScreenshotClipboardError).reason).toBe("failed");
    });

    it("does not leave a write rejection unhandled while the capture is still running", async () => {
      const image: Deferred<Blob> = makeDeferred<Blob>();

      installClipboard({
        write: (): Promise<void> => {
          return Promise.reject(new DOMException("No", "NotAllowedError"));
        },
      });

      const copied: Promise<void> = copyReplayScreenshotToClipboard(
        image.promise,
      );

      await flushRejectionTracking();
      image.resolve(makePng());

      const error: unknown = await catchRejection(copied);

      expect((error as ReplayScreenshotClipboardError).reason).toBe("denied");
    });
  });
});

describe("downloadReplayScreenshot", () => {
  interface AnchorAtClick {
    anchor: HTMLAnchorElement;
    href: string;
    download: string;
    rel: string;
    display: string;
    parent: Node | null;
  }

  let createObjectURL: MockFunction;
  let revokeObjectURL: MockFunction;
  let clicks: Array<AnchorAtClick>;
  let clickError: Error | null;

  beforeEach(() => {
    jest.useFakeTimers();
    clicks = [];
    clickError = null;
    createObjectURL = getJestMockFunction().mockReturnValue(OBJECT_URL);
    revokeObjectURL = getJestMockFunction();
    overrideProperty(window.URL, "createObjectURL", createObjectURL);
    overrideProperty(window.URL, "revokeObjectURL", revokeObjectURL);

    const click: SpyInstance<() => void> = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement): void {
        clicks.push({
          anchor: this,
          href: this.href,
          download: this.download,
          rel: this.rel,
          display: this.style.display,
          parent: this.parentNode,
        });

        if (clickError) {
          throw clickError;
        }
      });

    restorers.push((): void => {
      click.mockRestore();
    });
  });

  it("saves through a hidden, noopener anchor named after the screenshot", () => {
    const blob: Blob = makePng();

    downloadReplayScreenshot({
      blob: blob,
      fileName: "session-replay-3f9a2c1b-4m07.3s.png",
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0]).toBe(blob);
    expect(clicks).toHaveLength(1);

    const click: AnchorAtClick = clicks[0] as AnchorAtClick;

    expect(click.href).toBe(OBJECT_URL);
    expect(click.download).toBe("session-replay-3f9a2c1b-4m07.3s.png");
    expect(click.rel).toBe("noopener");
    expect(click.display).toBe("none");
    expect(click.parent).toBe(document.body);
  });

  it("removes its anchor after the click and leaves the page's own links alone", () => {
    const existing: HTMLAnchorElement = document.createElement("a");

    existing.href = "https://oneuptime.test/docs";
    document.body.appendChild(existing);

    downloadReplayScreenshot({ blob: makePng(), fileName: "frame.png" });

    const click: AnchorAtClick = clicks[0] as AnchorAtClick;

    expect(click.anchor.isConnected).toBe(false);
    expect(document.querySelectorAll("a")).toHaveLength(1);
    expect(document.querySelector("a")).toBe(existing);
  });

  it("keeps the object URL alive for REPLAY_SCREENSHOT_URL_TTL_MS after the click", () => {
    downloadReplayScreenshot({ blob: makePng(), fileName: "frame.png" });

    expect(revokeObjectURL).not.toHaveBeenCalled();

    jest.advanceTimersByTime(REPLAY_SCREENSHOT_URL_TTL_MS - 1);

    expect(revokeObjectURL).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);

    jest.advanceTimersByTime(REPLAY_SCREENSHOT_URL_TTL_MS * 2);

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("still removes the anchor and revokes the URL when the click throws, and rethrows", () => {
    const blocked: Error = new Error("Download blocked by the browser");

    clickError = blocked;

    expect((): void => {
      downloadReplayScreenshot({ blob: makePng(), fileName: "frame.png" });
    }).toThrow(blocked);

    expect(clicks).toHaveLength(1);
    expect((clicks[0] as AnchorAtClick).anchor.isConnected).toBe(false);
    expect(document.querySelectorAll("a")).toHaveLength(0);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    jest.advanceTimersByTime(REPLAY_SCREENSHOT_URL_TTL_MS);

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });

  it("gives each download its own URL, revoked on its own clock", () => {
    const firstUrl: string = "blob:https://oneuptime.test/first";
    const secondUrl: string = "blob:https://oneuptime.test/second";

    createObjectURL
      .mockReturnValueOnce(firstUrl)
      .mockReturnValueOnce(secondUrl);

    downloadReplayScreenshot({ blob: makePng(), fileName: "first.png" });
    jest.advanceTimersByTime(REPLAY_SCREENSHOT_URL_TTL_MS / 2);
    downloadReplayScreenshot({ blob: makePng(), fileName: "second.png" });

    expect(
      clicks.map((click: AnchorAtClick): string => {
        return click.href;
      }),
    ).toEqual([firstUrl, secondUrl]);

    jest.advanceTimersByTime(REPLAY_SCREENSHOT_URL_TTL_MS / 2);

    expect(revokeObjectURL.mock.calls).toEqual([[firstUrl]]);

    jest.advanceTimersByTime(REPLAY_SCREENSHOT_URL_TTL_MS / 2);

    expect(revokeObjectURL.mock.calls).toEqual([[firstUrl], [secondUrl]]);
  });
});
