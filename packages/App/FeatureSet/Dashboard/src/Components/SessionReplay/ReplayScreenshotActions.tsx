import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { ReplayFrameCaptureError } from "./ReplayFrameCapture";
import {
  ReplayImageClipboardSupport,
  ReplayScreenshot,
  ReplayScreenshotClipboardError,
  copyReplayScreenshotToClipboard,
  downloadReplayScreenshot,
  getReplayImageClipboardSupport,
} from "./ReplayScreenshot";
import { ReplayStageFit } from "./ReplayStage";

/*
 * The paused stage's screenshot dock: "Copy image" and "Download", in the
 * bottom-right corner of the picture, for exactly as long as the viewer
 * has stopped on a frame.
 *
 * It is drawn in the stage overlays' own dark glass (the paused button,
 * the idle chip, the notices) rather than as toolbar chrome: it is a
 * thing you do TO the picture, it has to read over any recorded page -
 * white, dark, busy - and it must not cost the transport row a slot for
 * a control that only means something while paused.
 *
 * What a capture feels like:
 *  - the pressed button spins while the frame is drawn (a few hundred
 *    milliseconds on a heavy page),
 *  - the stage flashes, the way a camera does, when it lands,
 *  - a card slides in above the dock with a thumbnail of exactly what was
 *    captured, what happened to it and its size or file name, and leaves
 *    by itself a few seconds later,
 *  - a failure says what went wrong in words and offers the way out:
 *    "Download instead" when only the clipboard failed, "Try again" when
 *    the frame could not be drawn.
 * Every outcome is also announced to screen readers.
 */

export type ReplayScreenshotAction = "copy" | "download";

/* How long the button shows its check, and the card its thumbnail. */
export const REPLAY_SCREENSHOT_DONE_MS: number = 2000;
export const REPLAY_SCREENSHOT_PREVIEW_MS: number = 5000;
/* The flash's fade; the class below carries the same number. */
export const REPLAY_SCREENSHOT_FLASH_MS: number = 500;

export interface ReplayScreenshotFailureCopy {
  title: string;
  description: string;
  /* The way out: take the PNG another way, or run the capture again. */
  recovery: "download" | "retry";
}

/*
 * Words for a failed screenshot. A clipboard that refused leaves a
 * perfectly good PNG behind, so the way out is to download it; a frame
 * that could not be drawn is worth one more try.
 */
export function describeReplayScreenshotFailure(
  error: unknown,
): ReplayScreenshotFailureCopy {
  if (error instanceof ReplayScreenshotClipboardError) {
    switch (error.reason) {
      case "insecure-context":
        return {
          title: "Copying images needs HTTPS",
          description:
            "Browsers only let a secure (https) page put images on the clipboard. Download the PNG instead.",
          recovery: "download",
        };
      case "unsupported":
        return {
          title: "This browser can't copy images",
          description:
            "It has no image clipboard. Download the PNG instead - it is the same picture.",
          recovery: "download",
        };
      case "denied":
        return {
          title: "Clipboard access was blocked",
          description:
            "Allow clipboard access for this site in the browser, or download the PNG instead.",
          recovery: "download",
        };
      case "failed":
      default:
        return {
          title: "Couldn't copy the image",
          description:
            "The clipboard did not take it. Download the PNG instead.",
          recovery: "download",
        };
    }
  }

  if (error instanceof ReplayFrameCaptureError) {
    switch (error.reason) {
      case "no-document":
      case "empty-viewport":
        return {
          title: "The frame isn't ready yet",
          description:
            "The replay has not finished drawing this moment. Give it a second and try again.",
          recovery: "retry",
        };
      case "encode-failed":
        return {
          title: "Couldn't save this frame",
          description: "The browser would not export the picture as a PNG.",
          recovery: "retry",
        };
      case "render-failed":
      default:
        return {
          title: "Couldn't capture this frame",
          description:
            "The browser could not draw this recorded page as an image.",
          recovery: "retry",
        };
    }
  }

  return {
    title: "Couldn't capture this frame",
    description: "Something went wrong while drawing the picture.",
    recovery: "retry",
  };
}

/*
 * Clear of the stage's scrollbars: the Width fit scrolls vertically and
 * 1:1 on both axes, and the dock must not sit on a scrollbar thumb.
 */
export function getReplayScreenshotDockPositionClassName(
  fit: ReplayStageFit | undefined,
): string {
  switch (fit) {
    case "width":
      return "bottom-3 right-6";
    case "actual":
      return "bottom-6 right-6";
    case "contain":
    default:
      return "bottom-3 right-3";
  }
}

export function formatReplayScreenshotSize(
  width: number,
  height: number,
): string {
  return `${Math.round(width)} × ${Math.round(height)}`;
}

export interface ReplayScreenshotActionsProps {
  /* Clones the paused frame now; resolves once it is a PNG. */
  onCapture: () => Promise<ReplayScreenshot>;
  fit?: ReplayStageFit | undefined;
  /*
   * Changes whenever the picture on the stage does (a seek while paused).
   * A PNG drawn from the previous frame is then no longer offered as the
   * "Download instead" of a failed copy, and that failure's card goes.
   */
  frameKey?: string | number | undefined;
  /* Seams for tests; the browser's own behaviour by default. */
  clipboardSupport?: ReplayImageClipboardSupport | undefined;
  copyToClipboard?: ((image: Promise<Blob>) => Promise<void>) | undefined;
  download?: ((screenshot: ReplayScreenshot) => void) | undefined;
}

interface ScreenshotPreview {
  action: ReplayScreenshotAction;
  fileName: string;
  width: number;
  height: number;
  /* An object URL for the thumbnail; null where the browser has none. */
  url: string | null;
}

interface ScreenshotFailure extends ReplayScreenshotFailureCopy {
  action: ReplayScreenshotAction;
}

type FlashStage = "idle" | "on" | "fading";

const DOCK_BUTTON_CLASS: string = [
  "relative inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-full",
  "text-xs font-medium text-white/90 transition-colors duration-100",
  "hover:bg-white/15 hover:text-white",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
  "disabled:cursor-not-allowed disabled:text-white/60 disabled:hover:bg-transparent",
  "sm:w-auto sm:px-3",
].join(" ");

const CARD_CLASS: string =
  "pointer-events-auto overflow-hidden rounded-xl bg-gray-900/85 text-white shadow-2xl shadow-black/30 ring-1 ring-white/15 backdrop-blur-md";

const CARD_DISMISS_CLASS: string =
  "-mr-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70";

function createPreviewUrl(blob: Blob): string | null {
  try {
    if (typeof window === "undefined" || !window.URL?.createObjectURL) {
      return null;
    }

    return window.URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function revokePreviewUrl(url: string | null): void {
  if (!url) {
    return;
  }

  try {
    window.URL.revokeObjectURL(url);
  } catch {
    /* Already gone. */
  }
}

const ReplayScreenshotActions: FunctionComponent<
  ReplayScreenshotActionsProps
> = (props: ReplayScreenshotActionsProps): ReactElement => {
  const { onCapture } = props;
  const copyToClipboard: (image: Promise<Blob>) => Promise<void> =
    props.copyToClipboard ?? copyReplayScreenshotToClipboard;
  const download: (screenshot: ReplayScreenshot) => void =
    props.download ?? downloadReplayScreenshot;
  const clipboardSupport: ReplayImageClipboardSupport =
    props.clipboardSupport ?? getReplayImageClipboardSupport();

  const [busyAction, setBusyAction] = useState<ReplayScreenshotAction | null>(
    null,
  );
  const [doneAction, setDoneAction] = useState<ReplayScreenshotAction | null>(
    null,
  );
  const [preview, setPreview] = useState<ScreenshotPreview | null>(null);
  const [failure, setFailure] = useState<ScreenshotFailure | null>(null);
  const [announcement, setAnnouncement] = useState<string>("");
  const [flash, setFlash] = useState<FlashStage>("idle");
  const [isEntered, setIsEntered] = useState<boolean>(false);

  /*
   * Refs, because a capture outlives the render that started it: the
   * busy guard must see a second click in the same frame, and a result
   * that lands after the viewer pressed Play must not touch an unmounted
   * component or leak its object URL.
   */
  const busyRef: React.MutableRefObject<ReplayScreenshotAction | null> =
    useRef<ReplayScreenshotAction | null>(null);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const previewUrlRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const lastScreenshotRef: React.MutableRefObject<ReplayScreenshot | null> =
    useRef<ReplayScreenshot | null>(null);
  const doneTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    const frame: number = window.requestAnimationFrame((): void => {
      setIsEntered(true);
    });

    return () => {
      isMountedRef.current = false;
      window.cancelAnimationFrame(frame);

      if (doneTimerRef.current !== null) {
        clearTimeout(doneTimerRef.current);
      }

      if (previewTimerRef.current !== null) {
        clearTimeout(previewTimerRef.current);
      }

      revokePreviewUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    lastScreenshotRef.current = null;
    setFailure(null);
  }, [props.frameKey]);

  /*
   * The flash: painted at full brightness for one frame, then faded. Two
   * animation frames, because a style set and replaced before the first
   * paint never transitions - the element has no "before" to fade from.
   */
  useEffect(() => {
    if (flash === "on") {
      let secondFrame: number = 0;
      const firstFrame: number = window.requestAnimationFrame((): void => {
        secondFrame = window.requestAnimationFrame((): void => {
          setFlash("fading");
        });
      });

      return () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
      };
    }

    if (flash === "fading") {
      const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
        setFlash("idle");
      }, REPLAY_SCREENSHOT_FLASH_MS);

      return () => {
        clearTimeout(timer);
      };
    }

    return undefined;
  }, [flash]);

  const dismissPreview: () => void = useCallback((): void => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    revokePreviewUrl(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreview(null);
  }, []);

  const dismissFailure: () => void = useCallback((): void => {
    setFailure(null);
  }, []);

  const succeed: (
    action: ReplayScreenshotAction,
    screenshot: ReplayScreenshot,
  ) => void = useCallback(
    (action: ReplayScreenshotAction, screenshot: ReplayScreenshot): void => {
      busyRef.current = null;

      if (!isMountedRef.current) {
        return;
      }

      lastScreenshotRef.current = screenshot;
      setBusyAction(null);
      setFailure(null);
      setDoneAction(action);
      setFlash("on");
      setAnnouncement(
        action === "copy"
          ? "Screenshot copied to the clipboard."
          : `Screenshot downloaded as ${screenshot.fileName}.`,
      );

      revokePreviewUrl(previewUrlRef.current);
      const url: string | null = createPreviewUrl(screenshot.blob);
      previewUrlRef.current = url;
      setPreview({
        action: action,
        fileName: screenshot.fileName,
        width: screenshot.width,
        height: screenshot.height,
        url: url,
      });

      if (doneTimerRef.current !== null) {
        clearTimeout(doneTimerRef.current);
      }

      doneTimerRef.current = setTimeout((): void => {
        doneTimerRef.current = null;
        setDoneAction(null);
      }, REPLAY_SCREENSHOT_DONE_MS);

      if (previewTimerRef.current !== null) {
        clearTimeout(previewTimerRef.current);
      }

      previewTimerRef.current = setTimeout((): void => {
        previewTimerRef.current = null;
        revokePreviewUrl(previewUrlRef.current);
        previewUrlRef.current = null;
        setPreview(null);
      }, REPLAY_SCREENSHOT_PREVIEW_MS);
    },
    [],
  );

  const fail: (action: ReplayScreenshotAction, error: unknown) => void =
    useCallback(
      (action: ReplayScreenshotAction, error: unknown): void => {
        busyRef.current = null;

        if (!isMountedRef.current) {
          return;
        }

        const copy: ReplayScreenshotFailureCopy =
          describeReplayScreenshotFailure(error);

        setBusyAction(null);
        setDoneAction(null);
        dismissPreview();
        setFailure({ ...copy, action: action });
        setAnnouncement("");
      },
      [dismissPreview],
    );

  const begin: (action: ReplayScreenshotAction) => boolean = useCallback(
    (action: ReplayScreenshotAction): boolean => {
      if (busyRef.current !== null) {
        return false;
      }

      busyRef.current = action;
      lastScreenshotRef.current = null;
      setBusyAction(action);
      setFailure(null);
      setAnnouncement("");

      return true;
    },
    [],
  );

  const startCapture: () => Promise<ReplayScreenshot> =
    useCallback((): Promise<ReplayScreenshot> => {
      try {
        return onCapture();
      } catch (error: unknown) {
        return Promise.reject(error);
      }
    }, [onCapture]);

  const copyImage: () => void = useCallback((): void => {
    if (clipboardSupport !== "supported") {
      /*
       * Nothing to try: say why straight away and offer the download,
       * which captures the same frame.
       */
      fail(
        "copy",
        new ReplayScreenshotClipboardError(
          clipboardSupport,
          "This browser cannot put images on the clipboard here.",
        ),
      );
      return;
    }

    if (!begin("copy")) {
      return;
    }

    const capture: Promise<ReplayScreenshot> = startCapture();

    capture.then(
      (screenshot: ReplayScreenshot): void => {
        lastScreenshotRef.current = screenshot;
      },
      (): void => {
        /* Reported through the clipboard promise below. */
      },
    );

    /*
     * Handed to the clipboard synchronously, inside this click: see
     * copyReplayScreenshotToClipboard for why Safari needs it that way.
     */
    copyToClipboard(
      capture.then((screenshot: ReplayScreenshot): Blob => {
        return screenshot.blob;
      }),
    ).then(
      (): void => {
        capture.then(
          (screenshot: ReplayScreenshot): void => {
            succeed("copy", screenshot);
          },
          (error: unknown): void => {
            fail("copy", error);
          },
        );
      },
      (error: unknown): void => {
        fail("copy", error);
      },
    );
  }, [clipboardSupport, begin, startCapture, copyToClipboard, succeed, fail]);

  const downloadImage: () => void = useCallback((): void => {
    if (!begin("download")) {
      return;
    }

    startCapture().then(
      (screenshot: ReplayScreenshot): void => {
        try {
          download(screenshot);
        } catch (error: unknown) {
          fail("download", error);
          return;
        }

        succeed("download", screenshot);
      },
      (error: unknown): void => {
        fail("download", error);
      },
    );
  }, [begin, startCapture, download, succeed, fail]);

  /*
   * "Download instead" after a clipboard failure saves the PNG that was
   * already drawn - the frame on the stage is the same one - rather than
   * drawing it twice. With nothing drawn yet it captures afresh.
   */
  const recover: () => void = useCallback((): void => {
    if (!failure) {
      return;
    }

    if (failure.recovery === "retry") {
      if (failure.action === "copy") {
        copyImage();
      } else {
        downloadImage();
      }

      return;
    }

    const screenshot: ReplayScreenshot | null = lastScreenshotRef.current;

    if (!screenshot) {
      downloadImage();
      return;
    }

    try {
      download(screenshot);
    } catch (error: unknown) {
      fail("download", error);
      return;
    }

    succeed("download", screenshot);
  }, [failure, copyImage, downloadImage, download, succeed, fail]);

  const isBusy: boolean = busyAction !== null;
  const copyTitle: string =
    clipboardSupport === "supported"
      ? "Copy this frame to the clipboard as a PNG"
      : clipboardSupport === "insecure-context"
        ? "Copying images needs a secure (https) page - use Download"
        : "This browser can't copy images - use Download";

  const renderButtonIcon: (
    action: ReplayScreenshotAction,
    idleIcon: IconProp,
  ) => ReactElement = (
    action: ReplayScreenshotAction,
    idleIcon: IconProp,
  ): ReactElement => {
    if (busyAction === action) {
      return (
        <Icon
          icon={IconProp.Spinner}
          className="h-3.5 w-3.5 shrink-0 animate-spin"
        />
      );
    }

    if (doneAction === action) {
      return (
        <Icon
          icon={IconProp.Check}
          className="h-3.5 w-3.5 shrink-0 text-emerald-300"
        />
      );
    }

    return <Icon icon={idleIcon} className="h-3.5 w-3.5 shrink-0" />;
  };

  const enterClass: string = isEntered
    ? "translate-y-0 opacity-100"
    : "translate-y-1 opacity-0";

  return (
    <>
      {flash !== "idle" && (
        <div
          aria-hidden="true"
          data-testid="replay-screenshot-flash"
          className={`pointer-events-none absolute inset-0 bg-white motion-reduce:hidden ${
            flash === "on"
              ? "opacity-60"
              : "opacity-0 transition-opacity duration-500 ease-out"
          }`}
        />
      )}

      <div
        data-testid="replay-screenshot"
        className={`pointer-events-none absolute ${getReplayScreenshotDockPositionClassName(
          props.fit,
        )} flex max-w-[calc(100%-1.5rem)] flex-col items-end gap-2`}
      >
        {failure && (
          <div
            role="alert"
            data-testid="replay-screenshot-error"
            data-recovery={failure.recovery}
            className={`${CARD_CLASS} flex w-64 max-w-full items-start gap-2.5 px-3 py-2.5 text-xs ring-rose-400/30`}
          >
            <Icon
              icon={IconProp.ErrorSolid}
              className="mt-0.5 h-4 w-4 shrink-0 text-rose-400"
            />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{failure.title}</div>
              <p className="mt-0.5 leading-snug text-white/70">
                {failure.description}
              </p>
              <button
                type="button"
                data-testid="replay-screenshot-recover"
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                onClick={recover}
              >
                <Icon
                  icon={
                    failure.recovery === "download"
                      ? IconProp.Download
                      : IconProp.Refresh
                  }
                  className="h-3 w-3"
                />
                {failure.recovery === "download"
                  ? "Download instead"
                  : "Try again"}
              </button>
            </div>
            <button
              type="button"
              data-testid="replay-screenshot-error-dismiss"
              className={CARD_DISMISS_CLASS}
              aria-label="Dismiss"
              title="Dismiss"
              onClick={dismissFailure}
            >
              <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {!failure && preview && (
          <div
            data-testid="replay-screenshot-preview"
            data-action={preview.action}
            className={`${CARD_CLASS} w-52 max-w-full sm:w-60`}
          >
            {preview.url && (
              <div className="p-1.5 pb-0">
                <img
                  src={preview.url}
                  alt="The captured frame"
                  data-testid="replay-screenshot-thumbnail"
                  className="block max-h-36 w-full rounded-lg bg-white object-cover object-top ring-1 ring-white/10"
                  style={{
                    aspectRatio: `${preview.width} / ${preview.height}`,
                  }}
                />
              </div>
            )}
            <div className="flex items-start gap-2 px-3 py-2">
              <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                <Icon icon={IconProp.Check} className="h-2.5 w-2.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold">
                  {preview.action === "copy"
                    ? "Copied to clipboard"
                    : "Screenshot downloaded"}
                </div>
                <div
                  className="mt-0.5 truncate text-[11px] text-white/60"
                  title={preview.fileName}
                  data-testid="replay-screenshot-preview-detail"
                >
                  {preview.action === "copy"
                    ? `${formatReplayScreenshotSize(
                        preview.width,
                        preview.height,
                      )} PNG · paste it anywhere`
                    : preview.fileName}
                </div>
              </div>
              <button
                type="button"
                data-testid="replay-screenshot-preview-dismiss"
                className={CARD_DISMISS_CLASS}
                aria-label="Dismiss"
                title="Dismiss"
                onClick={dismissPreview}
              >
                <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        <div
          role="group"
          aria-label="Screenshot of this frame"
          data-testid="replay-screenshot-actions"
          className={`pointer-events-auto inline-flex items-center gap-0.5 rounded-full bg-gray-900/75 p-1 text-white shadow-lg shadow-black/20 ring-1 ring-white/15 backdrop-blur-md transition duration-200 ease-out motion-reduce:transition-none ${enterClass}`}
        >
          <button
            type="button"
            data-testid="replay-screenshot-copy"
            data-state={
              busyAction === "copy"
                ? "busy"
                : doneAction === "copy"
                  ? "done"
                  : "idle"
            }
            className={DOCK_BUTTON_CLASS}
            title={copyTitle}
            aria-label="Copy image"
            aria-busy={busyAction === "copy" || undefined}
            disabled={isBusy}
            onClick={copyImage}
          >
            {renderButtonIcon("copy", IconProp.Photo)}
            <span className="sr-only sm:not-sr-only">Copy image</span>
          </button>
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-white/20" />
          <button
            type="button"
            data-testid="replay-screenshot-download"
            data-state={
              busyAction === "download"
                ? "busy"
                : doneAction === "download"
                  ? "done"
                  : "idle"
            }
            className={DOCK_BUTTON_CLASS}
            title="Download this frame as a PNG"
            aria-label="Download"
            aria-busy={busyAction === "download" || undefined}
            disabled={isBusy}
            onClick={downloadImage}
          >
            {renderButtonIcon("download", IconProp.Download)}
            <span className="sr-only sm:not-sr-only">Download</span>
          </button>
        </div>

        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          data-testid="replay-screenshot-status"
        >
          {announcement}
        </span>
      </div>
    </>
  );
};

export default ReplayScreenshotActions;
