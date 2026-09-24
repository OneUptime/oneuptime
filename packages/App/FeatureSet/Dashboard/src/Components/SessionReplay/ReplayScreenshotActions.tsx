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
 *
 * On a phone the stage is too short for the thumbnail card - it would sit
 * on the paused Play button and reach up over the address bar - so the
 * confirmation shrinks to a pill beside the dock. And the keyboard never
 * loses its place: a busy button stays focusable, and a card that goes
 * away hands focus back to the dock, because focus dropped on <body>
 * turns the next Space into the player's play/pause.
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

/*
 * Below this much room between the top and the bottom of the stage (a
 * phone, where a desktop recording's stage is about 224px tall) the
 * thumbnail card would cover the paused Play button and reach up over the
 * address bar. The confirmation becomes a pill beside the dock instead.
 */
export const REPLAY_SCREENSHOT_COMPACT_STAGE_PX: number = 320;

interface ScreenshotPreview {
  action: ReplayScreenshotAction;
  fileName: string;
  /* The PNG's own size, which is the recorded viewport times its density. */
  pixelWidth: number;
  pixelHeight: number;
  /* The recorded viewport: the thumbnail's aspect ratio. */
  width: number;
  height: number;
  /* An object URL for the thumbnail; null where the browser has none. */
  url: string | null;
  isCompact: boolean;
}

interface ScreenshotFailure extends ReplayScreenshotFailureCopy {
  action: ReplayScreenshotAction;
}

type FlashStage = "idle" | "on" | "fading";

const DOCK_BUTTON_CLASS: string = [
  "relative inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-full",
  "text-xs font-medium transition-colors duration-100",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
  "sm:w-auto sm:px-3",
].join(" ");

/*
 * Busy is drawn and announced (aria-disabled, aria-busy) but the button
 * is NOT disabled: a disabled button drops keyboard focus to <body>, and
 * from there the next Space is the player's play/pause shortcut.
 */
const DOCK_BUTTON_IDLE_CLASS: string =
  "text-white/90 hover:bg-white/15 hover:text-white";
const DOCK_BUTTON_BUSY_CLASS: string = "cursor-progress text-white/60";

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

function containsFocus(element: HTMLElement | null): boolean {
  if (!element || typeof document === "undefined") {
    return false;
  }

  const active: Element | null = document.activeElement;

  return Boolean(active) && element.contains(active);
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
   * busy guard must see a second click in the same frame, a result that
   * lands after the viewer pressed Play must not touch an unmounted
   * component or leak its object URL, and a PNG of a frame the viewer
   * has since seeked away from must not be kept for "Download instead".
   */
  const busyRef: React.MutableRefObject<ReplayScreenshotAction | null> =
    useRef<ReplayScreenshotAction | null>(null);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const previewUrlRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const lastScreenshotRef: React.MutableRefObject<ReplayScreenshot | null> =
    useRef<ReplayScreenshot | null>(null);
  const frameKeyRef: React.MutableRefObject<string | number | undefined> =
    useRef<string | number | undefined>(props.frameKey);
  const doneTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  const columnRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const copyButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const downloadButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const errorCardRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const previewCardRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const failureRef: React.MutableRefObject<ScreenshotFailure | null> =
    useRef<ScreenshotFailure | null>(null);
  /* The card waits for the pointer and the keyboard both to have left. */
  const isPointerOnPreviewRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  failureRef.current = failure;

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

  /*
   * A new frame (a seek while paused) takes the error card with it. The
   * player's arrow keys seek even with focus on a card button, so the
   * focus goes back to the dock first rather than down to <body>.
   */
  useEffect(() => {
    frameKeyRef.current = props.frameKey;
    lastScreenshotRef.current = null;

    const failed: ScreenshotFailure | null = failureRef.current;

    if (failed && containsFocus(errorCardRef.current)) {
      (failed.action === "copy"
        ? copyButtonRef.current
        : downloadButtonRef.current
      )?.focus();
    }

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

  /*
   * A card that is about to go must not take the keyboard focus with it:
   * focus dropped on <body> turns the next Space into the player's
   * play/pause. It goes back to the dock button the card was about.
   */
  const keepFocusInDock: (action: ReplayScreenshotAction) => void = useCallback(
    (action: ReplayScreenshotAction): void => {
      if (
        !containsFocus(errorCardRef.current) &&
        !containsFocus(previewCardRef.current)
      ) {
        return;
      }

      const target: HTMLButtonElement | null =
        action === "copy" ? copyButtonRef.current : downloadButtonRef.current;

      target?.focus();
    },
    [],
  );

  const clearPreviewTimer: () => void = useCallback((): void => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);

  const removePreview: () => void = useCallback((): void => {
    isPointerOnPreviewRef.current = false;
    clearPreviewTimer();
    revokePreviewUrl(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreview(null);
  }, [clearPreviewTimer]);

  const dismissPreview: () => void = useCallback((): void => {
    if (preview) {
      keepFocusInDock(preview.action);
    }

    removePreview();
  }, [preview, keepFocusInDock, removePreview]);

  /*
   * The card leaves by itself - but not from under a pointer that is on
   * it or a keyboard that is in it; it waits until they have left.
   */
  const schedulePreviewRemoval: () => void = useCallback((): void => {
    clearPreviewTimer();
    previewTimerRef.current = setTimeout((): void => {
      previewTimerRef.current = null;

      if (
        isPointerOnPreviewRef.current ||
        containsFocus(previewCardRef.current)
      ) {
        return;
      }

      removePreview();
    }, REPLAY_SCREENSHOT_PREVIEW_MS);
  }, [clearPreviewTimer, removePreview]);

  const dismissFailure: () => void = useCallback((): void => {
    if (failure) {
      keepFocusInDock(failure.action);
    }

    setFailure(null);
  }, [failure, keepFocusInDock]);

  const succeed: (
    action: ReplayScreenshotAction,
    screenshot: ReplayScreenshot,
    frameKey: string | number | undefined,
  ) => void = useCallback(
    (
      action: ReplayScreenshotAction,
      screenshot: ReplayScreenshot,
      frameKey: string | number | undefined,
    ): void => {
      busyRef.current = null;

      if (!isMountedRef.current) {
        return;
      }

      if (frameKey === frameKeyRef.current) {
        lastScreenshotRef.current = screenshot;
      }

      keepFocusInDock(action);
      setBusyAction(null);
      setFailure(null);
      setDoneAction(action);
      setFlash("on");
      setAnnouncement(
        action === "copy"
          ? "Screenshot copied to the clipboard."
          : `Screenshot downloaded as ${screenshot.fileName}.`,
      );

      const columnHeight: number = columnRef.current?.clientHeight ?? 0;

      revokePreviewUrl(previewUrlRef.current);
      const url: string | null = createPreviewUrl(screenshot.blob);
      previewUrlRef.current = url;
      setPreview({
        action: action,
        fileName: screenshot.fileName,
        pixelWidth: screenshot.pixelWidth ?? screenshot.width,
        pixelHeight: screenshot.pixelHeight ?? screenshot.height,
        width: screenshot.width,
        height: screenshot.height,
        url: url,
        /* 0 is "not measured" (no layout): keep the full card. */
        isCompact:
          columnHeight > 0 && columnHeight < REPLAY_SCREENSHOT_COMPACT_STAGE_PX,
      });

      if (doneTimerRef.current !== null) {
        clearTimeout(doneTimerRef.current);
      }

      doneTimerRef.current = setTimeout((): void => {
        doneTimerRef.current = null;
        setDoneAction(null);
      }, REPLAY_SCREENSHOT_DONE_MS);

      schedulePreviewRemoval();
    },
    [keepFocusInDock, schedulePreviewRemoval],
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

        keepFocusInDock(action);
        setBusyAction(null);
        setDoneAction(null);
        removePreview();
        setFailure({ ...copy, action: action });
        setAnnouncement("");
      },
      [keepFocusInDock, removePreview],
    );

  /* The frame the attempt is for, or null when one is already running. */
  const begin: (
    action: ReplayScreenshotAction,
  ) => { frameKey: string | number | undefined } | null = useCallback(
    (
      action: ReplayScreenshotAction,
    ): { frameKey: string | number | undefined } | null => {
      if (busyRef.current !== null) {
        return null;
      }

      keepFocusInDock(action);
      busyRef.current = action;
      lastScreenshotRef.current = null;
      setBusyAction(action);
      setFailure(null);
      setAnnouncement("");

      return { frameKey: frameKeyRef.current };
    },
    [keepFocusInDock],
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
    if (busyRef.current !== null) {
      return;
    }

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

    const attempt: { frameKey: string | number | undefined } | null =
      begin("copy");

    if (!attempt) {
      return;
    }

    const capture: Promise<ReplayScreenshot> = startCapture();

    capture.then(
      (screenshot: ReplayScreenshot): void => {
        /* Kept for "Download instead", if the clipboard refuses it. */
        if (attempt.frameKey === frameKeyRef.current) {
          lastScreenshotRef.current = screenshot;
        }
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
            succeed("copy", screenshot, attempt.frameKey);
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
    const attempt: { frameKey: string | number | undefined } | null =
      begin("download");

    if (!attempt) {
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

        succeed("download", screenshot, attempt.frameKey);
      },
      (error: unknown): void => {
        fail("download", error);
      },
    );
  }, [begin, startCapture, download, succeed, fail]);

  /*
   * "Download instead" after a clipboard failure saves the PNG that was
   * already drawn - the frame on the stage is the same one - rather than
   * drawing it twice. With nothing drawn for this frame it captures
   * afresh.
   */
  const recover: () => void = useCallback((): void => {
    if (!failure || busyRef.current !== null) {
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

    succeed("download", screenshot, frameKeyRef.current);
  }, [failure, copyImage, downloadImage, download, succeed, fail]);

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

  const getButtonState: (action: ReplayScreenshotAction) => string = (
    action: ReplayScreenshotAction,
  ): string => {
    if (busyAction === action) {
      return "busy";
    }

    return doneAction === action ? "done" : "idle";
  };

  const isBusy: boolean = busyAction !== null;
  const buttonClass: string = `${DOCK_BUTTON_CLASS} ${
    isBusy ? DOCK_BUTTON_BUSY_CLASS : DOCK_BUTTON_IDLE_CLASS
  }`;
  const enterClass: string = isEntered
    ? "translate-y-0 opacity-100"
    : "translate-y-1 opacity-0";
  const previewDetail: string = preview
    ? preview.action === "copy"
      ? `${formatReplayScreenshotSize(
          preview.pixelWidth,
          preview.pixelHeight,
        )} PNG`
      : preview.fileName
    : "";
  const previewTitle: string =
    preview?.action === "copy"
      ? "Copied to clipboard"
      : "Screenshot downloaded";
  const previewHoldHandlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  } = {
    onMouseEnter: (): void => {
      isPointerOnPreviewRef.current = true;
      clearPreviewTimer();
    },
    onMouseLeave: (): void => {
      isPointerOnPreviewRef.current = false;
      schedulePreviewRemoval();
    },
    onFocus: clearPreviewTimer,
    onBlur: (event: React.FocusEvent<HTMLDivElement>): void => {
      if (
        !isPointerOnPreviewRef.current &&
        (!event.relatedTarget ||
          !event.currentTarget.contains(event.relatedTarget as Node))
      ) {
        schedulePreviewRemoval();
      }
    },
  };

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

      {/*
       * The column spans the stage from top to bottom and stacks from the
       * bottom, so a card can grow up to the stage's top edge and no
       * further: the thumbnail and the error text give way first.
       */}
      <div
        ref={columnRef}
        data-testid="replay-screenshot"
        className={`pointer-events-none absolute top-3 ${getReplayScreenshotDockPositionClassName(
          props.fit,
        )} flex max-w-[calc(100%-1.5rem)] flex-col items-end justify-end gap-2`}
      >
        {failure && (
          <div
            ref={errorCardRef}
            role="alert"
            data-testid="replay-screenshot-error"
            data-recovery={failure.recovery}
            className={`${CARD_CLASS} flex min-h-0 w-64 max-w-full shrink items-start gap-2.5 overflow-y-auto px-3 py-2.5 text-xs ring-rose-400/30`}
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

        {!failure && preview && !preview.isCompact && (
          <div
            ref={previewCardRef}
            data-testid="replay-screenshot-preview"
            data-action={preview.action}
            className={`${CARD_CLASS} flex min-h-0 w-56 max-w-full shrink flex-col sm:w-60`}
            {...previewHoldHandlers}
          >
            {preview.url && (
              <div className="min-h-0 shrink overflow-hidden p-1.5 pb-0">
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
            <div className="flex shrink-0 items-start gap-2 px-3 py-2">
              <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                <Icon icon={IconProp.Check} className="h-2.5 w-2.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold">{previewTitle}</div>
                <div
                  className="mt-0.5 truncate text-[11px] text-white/60"
                  title={preview.fileName}
                  data-testid="replay-screenshot-preview-detail"
                >
                  {previewDetail}
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

        <div className="flex max-w-full shrink-0 items-center justify-end gap-2">
          {!failure && preview && preview.isCompact && (
            <div
              ref={previewCardRef}
              data-testid="replay-screenshot-preview"
              data-action={preview.action}
              data-compact="true"
              title={`${previewTitle}: ${previewDetail}`}
              className="pointer-events-auto inline-flex h-10 min-w-0 items-center gap-1.5 rounded-full bg-gray-900/85 pl-3 pr-1 text-xs font-semibold text-white shadow-lg shadow-black/20 ring-1 ring-white/15 backdrop-blur-md"
              {...previewHoldHandlers}
            >
              <Icon
                icon={IconProp.Check}
                className="h-3.5 w-3.5 shrink-0 text-emerald-300"
              />
              <span className="truncate">
                {preview.action === "copy" ? "Copied" : "Saved"}
              </span>
              <button
                type="button"
                data-testid="replay-screenshot-preview-dismiss"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={dismissPreview}
              >
                <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div
            role="group"
            aria-label="Screenshot of this frame"
            data-testid="replay-screenshot-actions"
            className={`pointer-events-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-gray-900/75 p-1 text-white shadow-lg shadow-black/20 ring-1 ring-white/15 backdrop-blur-md transition duration-200 ease-out motion-reduce:transition-none ${enterClass}`}
          >
            <button
              ref={copyButtonRef}
              type="button"
              data-testid="replay-screenshot-copy"
              data-state={getButtonState("copy")}
              className={buttonClass}
              title={copyTitle}
              aria-label="Copy image"
              aria-busy={busyAction === "copy" || undefined}
              aria-disabled={isBusy || undefined}
              onClick={copyImage}
            >
              {renderButtonIcon("copy", IconProp.Photo)}
              <span className="sr-only sm:not-sr-only">Copy image</span>
            </button>
            <span
              aria-hidden="true"
              className="h-4 w-px shrink-0 bg-white/20"
            />
            <button
              ref={downloadButtonRef}
              type="button"
              data-testid="replay-screenshot-download"
              data-state={getButtonState("download")}
              className={buttonClass}
              title="Download this frame as a PNG"
              aria-label="Download"
              aria-busy={busyAction === "download" || undefined}
              aria-disabled={isBusy || undefined}
              onClick={downloadImage}
            >
              {renderButtonIcon("download", IconProp.Download)}
              <span className="sr-only sm:not-sr-only">Download</span>
            </button>
          </div>
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
