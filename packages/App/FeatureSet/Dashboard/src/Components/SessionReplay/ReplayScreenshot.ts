import { ReplayerLike } from "./Engine/ReplayEngineTypes";
import {
  ReplayFrameCaptureError,
  ReplayFramePointer,
  ReplayFrameRasterDeps,
  ReplayFrameViewport,
  captureReplayFrame,
} from "./ReplayFrameCapture";

/*
 * The screenshot actions the paused stage offers: capture the frame the
 * viewer stopped on, then put it on the clipboard or save it as a PNG.
 *
 * ReplayFrameCapture knows how to draw a replay document; this file knows
 * the player - which document is live, how big the recording was, where
 * the stage drew the pointer, what the file should be called - and the
 * browser APIs around it. The shell is not allowed to touch the clipboard
 * itself (SessionReplayPlayerWiring.test.ts), which is why the clipboard
 * code lives here and not in the shell.
 */

export interface ReplayScreenshot {
  blob: Blob;
  fileName: string;
  /* The recorded viewport, in CSS pixels; the PNG may be denser. */
  width: number;
  height: number;
}

export interface ReplayScreenshotRequest {
  /* The live Replayer; null before the first frame or after a teardown. */
  replayer: ReplayerLike | null;
  sessionId: string;
  offsetMs: number;
  /* "Tab 2" when the session has several tabs, so the file says which. */
  tabLabel?: string | null | undefined;
  pixelRatio?: number | undefined;
  /* The canvas and image loading, for tests that have neither. */
  deps?: Partial<ReplayFrameRasterDeps> | undefined;
}

/* ---- File name. ---- */

const SESSION_ID_UNSAFE_PATTERN: RegExp = /[^a-z0-9]/g;
const LABEL_UNSAFE_PATTERN: RegExp = /[^a-z0-9]+/g;
const EDGE_DASHES_PATTERN: RegExp = /^-+|-+$/g;

/*
 * The playhead as a file-name-safe offset: "0m07.3s", "12m05.0s",
 * "1h02m03.4s". The clock's own "1:02.3" cannot be used - a colon is not
 * allowed in a Windows file name - and tenths keep two shots a few frames
 * apart from colliding.
 */
export function formatReplayScreenshotOffset(offsetMs: number): string {
  const safeMs: number =
    Number.isFinite(offsetMs) && offsetMs > 0 ? Math.floor(offsetMs) : 0;
  const totalTenths: number = Math.floor(safeMs / 100);
  const tenths: number = totalTenths % 10;
  const totalSeconds: number = Math.floor(totalTenths / 10);
  const seconds: number = totalSeconds % 60;
  const totalMinutes: number = Math.floor(totalSeconds / 60);
  const minutes: number = totalMinutes % 60;
  const hours: number = Math.floor(totalMinutes / 60);
  const secondsText: string = `${String(seconds).padStart(2, "0")}.${tenths}s`;

  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}m${secondsText}`;
  }

  return `${minutes}m${secondsText}`;
}

/*
 * "session-replay-3f9a2c1b-4m07.3s.png", or with the tab when there is
 * more than one: "session-replay-3f9a2c1b-tab-2-4m07.3s.png". The first
 * eight characters of the id are what the header shows; nothing about
 * the end user goes into a name that ends up in a Downloads folder.
 */
export function buildReplayScreenshotFileName(input: {
  sessionId: string;
  offsetMs: number;
  tabLabel?: string | null | undefined;
}): string {
  const sessionPart: string =
    (input.sessionId || "")
      .toLowerCase()
      .replace(SESSION_ID_UNSAFE_PATTERN, "")
      .slice(0, 8) || "session";
  const tabPart: string = (input.tabLabel || "")
    .toLowerCase()
    .replace(LABEL_UNSAFE_PATTERN, "-")
    .replace(EDGE_DASHES_PATTERN, "")
    .slice(0, 24);

  return [
    "session-replay",
    sessionPart,
    tabPart,
    formatReplayScreenshotOffset(input.offsetMs),
  ]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join("-")
    .concat(".png");
}

/* ---- What to capture. ---- */

function readPositiveNumber(value: string | null | undefined): number | null {
  const parsed: number = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/*
 * The recorded viewport. The Replayer sizes its iframe with width and
 * height ATTRIBUTES at exactly the recorded size and scales the host
 * around it, so the attributes are the unscaled truth; the client box is
 * the fallback for an iframe that has none.
 */
export function readReplayViewport(
  iframe: HTMLIFrameElement,
): ReplayFrameViewport | null {
  const width: number | null =
    readPositiveNumber(iframe.getAttribute("width")) ??
    readPositiveNumber(String(iframe.clientWidth));
  const height: number | null =
    readPositiveNumber(iframe.getAttribute("height")) ??
    readPositiveNumber(String(iframe.clientHeight));

  if (width === null || height === null) {
    return null;
  }

  return { width: width, height: height };
}

/*
 * Where the stage draws the pointer, in recorded pixels. The pointer is
 * the Replayer's .replayer-mouse element, which lives OUTSIDE the replay
 * document (it is stage chrome), so a document capture would lose it. Its
 * left/top are recorded coordinates and the dot is drawn from that
 * corner, so the centre the viewer sees is half its box further in. A
 * hidden pointer (a touch recording, or one that has not moved yet) is
 * left out.
 */
export function readReplayPointer(
  wrapper: HTMLElement,
): ReplayFramePointer | null {
  const pointer: HTMLElement | null =
    wrapper.querySelector<HTMLElement>(".replayer-mouse");

  if (!pointer || !pointer.style.left || !pointer.style.top) {
    return null;
  }

  const view: Window | null = pointer.ownerDocument.defaultView;
  const style: CSSStyleDeclaration | null = view
    ? view.getComputedStyle(pointer)
    : null;

  if (
    !style ||
    style.display === "none" ||
    style.visibility === "hidden" ||
    pointer.classList.contains("touch-device")
  ) {
    return null;
  }

  const left: number = parseFloat(pointer.style.left);
  const top: number = parseFloat(pointer.style.top);

  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return null;
  }

  const width: number = pointer.offsetWidth || parseFloat(style.width) || 0;
  const height: number = pointer.offsetHeight || parseFloat(style.height) || 0;
  const marginLeft: number = parseFloat(style.marginLeft) || 0;
  const marginTop: number = parseFloat(style.marginTop) || 0;

  return {
    x: left + marginLeft + width / 2,
    y: top + marginTop + height / 2,
  };
}

function getDevicePixelRatio(): number {
  return typeof window !== "undefined" && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
}

/*
 * Captures the live Replayer's frame. The document is cloned before this
 * returns - playback that resumes while the PNG encodes does not change
 * it - and the promise rejects with a ReplayFrameCaptureError.
 */
export function captureReplayerScreenshot(
  request: ReplayScreenshotRequest,
): Promise<ReplayScreenshot> {
  const replayer: ReplayerLike | null = request.replayer;
  let replayDocument: Document | null = null;

  try {
    replayDocument = replayer ? replayer.iframe.contentDocument : null;
  } catch {
    replayDocument = null;
  }

  if (!replayer || !replayDocument || !replayDocument.documentElement) {
    return Promise.reject(
      new ReplayFrameCaptureError(
        "no-document",
        "The replay has not drawn a frame yet.",
      ),
    );
  }

  const viewport: ReplayFrameViewport | null = readReplayViewport(
    replayer.iframe,
  );

  if (!viewport) {
    return Promise.reject(
      new ReplayFrameCaptureError(
        "empty-viewport",
        "The recorded viewport has no size yet.",
      ),
    );
  }

  const fileName: string = buildReplayScreenshotFileName({
    sessionId: request.sessionId,
    offsetMs: request.offsetMs,
    tabLabel: request.tabLabel,
  });

  return captureReplayFrame({
    document: replayDocument,
    viewport: viewport,
    pointer: readReplayPointer(replayer.wrapper),
    pixelRatio: request.pixelRatio ?? getDevicePixelRatio(),
    deps: request.deps,
  }).then((blob: Blob): ReplayScreenshot => {
    return {
      blob: blob,
      fileName: fileName,
      width: viewport.width,
      height: viewport.height,
    };
  });
}

/* ---- Clipboard. ---- */

export type ReplayImageClipboardSupport =
  | "supported"
  | "insecure-context"
  | "unsupported";

/*
 * Image clipboard writes need the async Clipboard API with ClipboardItem,
 * and browsers only expose it on a secure page - a plain-http install has
 * no navigator.clipboard at all, which is worth telling apart from a
 * browser that simply lacks the feature.
 */
export function getReplayImageClipboardSupport(): ReplayImageClipboardSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "unsupported";
  }

  if (window.isSecureContext === false) {
    return "insecure-context";
  }

  const clipboard: Clipboard | undefined = navigator.clipboard;

  if (
    !clipboard ||
    typeof clipboard.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    return "unsupported";
  }

  return "supported";
}

export type ReplayClipboardFailure =
  | "unsupported"
  | "insecure-context"
  | "denied"
  | "failed";

export class ReplayScreenshotClipboardError extends Error {
  public readonly reason: ReplayClipboardFailure;

  public constructor(reason: ReplayClipboardFailure, message: string) {
    super(message);
    this.name = "ReplayScreenshotClipboardError";
    this.reason = reason;
  }
}

function toClipboardError(error: unknown): ReplayScreenshotClipboardError {
  const name: string =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return new ReplayScreenshotClipboardError(
      "denied",
      "The browser blocked access to the clipboard.",
    );
  }

  if (name === "NotSupportedError" || name === "DataError") {
    return new ReplayScreenshotClipboardError(
      "unsupported",
      "This browser cannot put images on the clipboard.",
    );
  }

  return new ReplayScreenshotClipboardError(
    "failed",
    "The image could not be copied.",
  );
}

/*
 * Puts the PNG on the clipboard.
 *
 * Takes the image as a PROMISE and builds the ClipboardItem before the
 * first await. Safari only honours a clipboard write that starts inside
 * the click, and the capture takes longer than its user-activation
 * window - so the item has to be handed the pending image, not the
 * finished one. Chromium and Firefox accept the same form.
 *
 * A capture failure wins over the clipboard's own complaint about the
 * promise it was given, so the viewer hears what actually went wrong.
 */
export async function copyReplayScreenshotToClipboard(
  image: Promise<Blob>,
): Promise<void> {
  const support: ReplayImageClipboardSupport = getReplayImageClipboardSupport();

  if (support !== "supported") {
    image.catch((): void => {
      /* The capture's outcome no longer matters. */
    });

    throw new ReplayScreenshotClipboardError(
      support,
      support === "insecure-context"
        ? "Images can only be copied on a secure (https) page."
        : "This browser cannot put images on the clipboard.",
    );
  }

  let write: Promise<void>;

  try {
    write = navigator.clipboard.write([
      new ClipboardItem({ "image/png": image }),
    ]);
    /*
     * Marked handled now: the write may settle while the capture is still
     * running, and it is awaited (and its failure reported) below.
     */
    write.catch((): void => {
      /* Awaited below. */
    });
  } catch (error: unknown) {
    image.catch((): void => {
      /* Reported through the clipboard error below. */
    });

    throw toClipboardError(error);
  }

  /* The capture error is the one worth reporting, when there is one. */
  await image;

  try {
    await write;
  } catch (error: unknown) {
    throw toClipboardError(error);
  }
}

/* ---- Download. ---- */

/*
 * How long the object URL outlives the click. Revoking it in the same
 * task has cancelled the download in Safari; a minute is far longer than
 * any browser takes to start one, and the blob is released after it.
 */
export const REPLAY_SCREENSHOT_URL_TTL_MS: number = 60000;

export function downloadReplayScreenshot(screenshot: {
  blob: Blob;
  fileName: string;
}): void {
  const url: string = window.URL.createObjectURL(screenshot.blob);
  const anchor: HTMLAnchorElement = document.createElement("a");

  anchor.href = url;
  anchor.download = screenshot.fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout((): void => {
      window.URL.revokeObjectURL(url);
    }, REPLAY_SCREENSHOT_URL_TTL_MS);
  }
}
