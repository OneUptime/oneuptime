import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
/*
 * The Dashboard has its own copy of react; Common's jest moduleNameMapper
 * pins react and react-dom to this project's single copy for every
 * importer (see the note at the top of ReplayStage.test.tsx).
 */
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ReplayScreenshotActions, {
  REPLAY_SCREENSHOT_DONE_MS,
  REPLAY_SCREENSHOT_FLASH_MS,
  REPLAY_SCREENSHOT_PREVIEW_MS,
  ReplayScreenshotActionsProps,
  ReplayScreenshotFailureCopy,
  describeReplayScreenshotFailure,
  formatReplayScreenshotSize,
  getReplayScreenshotDockPositionClassName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScreenshotActions";
import {
  ReplayFrameCaptureError,
  ReplayFrameCaptureFailure,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayFrameCapture";
import {
  REPLAY_SCREENSHOT_URL_TTL_MS,
  ReplayClipboardFailure,
  ReplayScreenshot,
  ReplayScreenshotClipboardError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScreenshot";

/*
 * The paused stage's screenshot dock. Pinned: the "Screenshot of this
 * frame" group with Copy image and Download, and a copy title that says
 * why copying is unavailable on this page; the Safari rule - the
 * clipboard is handed the PENDING image synchronously inside the click,
 * before the capture lands; the busy and done button states and the one
 * capture at a time guard; the success card (a thumbnail from an object
 * URL, the size or the file name, the live-region words, the camera
 * flash) that leaves by itself and never leaks its object URL; failure
 * cards whose way out matches the failure - "Download instead" saves the
 * PNG a refused clipboard left behind without drawing it twice, "Try
 * again" re-runs a capture that could not be drawn; a new frame
 * (frameKey) forgets both the card and the PNG; and a capture that lands
 * after the dock unmounted (the viewer pressed Play) touches nothing.
 *
 * The component's seams stand in for the capture, the clipboard and the
 * download; the "default wiring" block drives the real ReplayScreenshot
 * helpers against a fake async Clipboard API and a spied anchor instead.
 * Fake timers drive requestAnimationFrame too, so the entrance and the
 * flash are stepped a frame at a time.
 */

const FILE_NAME: string = "session-replay-3f9a2c1b-0m41.2s.png";
const FRAME_MS: number = 16;

const COPY_TITLE_SUPPORTED: string =
  "Copy this frame to the clipboard as a PNG";
const COPY_TITLE_INSECURE: string =
  "Copying images needs a secure (https) page - use Download";
const COPY_TITLE_UNSUPPORTED: string =
  "This browser can't copy images - use Download";

function makeScreenshot(
  overrides?: Partial<ReplayScreenshot>,
): ReplayScreenshot {
  return {
    blob: new Blob(["png-bytes"], { type: "image/png" }),
    fileName: FILE_NAME,
    width: 1440,
    height: 900,
    ...overrides,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = (_value: T): void => {
    /* Replaced by the executor below. */
  };
  let rejectPromise: (error: unknown) => void = (_error: unknown): void => {
    /* Replaced by the executor below. */
  };
  const promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (error: unknown) => void): void => {
      resolvePromise = resolve;
      rejectPromise = reject;
    },
  );

  return {
    promise: promise,
    resolve: (value: T): void => {
      resolvePromise(value);
    },
    reject: (error: unknown): void => {
      rejectPromise(error);
    },
  };
}

function ignoreRejection(): void {
  /* The test reads this outcome elsewhere. */
}

interface ActionMocks {
  onCapture: MockFunction;
  copyToClipboard: MockFunction;
  download: MockFunction;
}

/*
 * A capture that resolves with the screenshot, a clipboard that takes the
 * image once it lands (as a browser does) and a download that works.
 */
function makeMocks(screenshot?: ReplayScreenshot): ActionMocks {
  const shot: ReplayScreenshot = screenshot ?? makeScreenshot();
  const onCapture: MockFunction = getJestMockFunction();
  const copyToClipboard: MockFunction = getJestMockFunction();
  const download: MockFunction = getJestMockFunction();

  onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
    return Promise.resolve(shot);
  });
  copyToClipboard.mockImplementation(
    async (image: Promise<Blob>): Promise<void> => {
      await image;
    },
  );

  return {
    onCapture: onCapture,
    copyToClipboard: copyToClipboard,
    download: download,
  };
}

function makeProps(
  mocks: ActionMocks,
  overrides?: Partial<ReplayScreenshotActionsProps>,
): ReplayScreenshotActionsProps {
  return {
    onCapture: mocks.onCapture,
    copyToClipboard: mocks.copyToClipboard,
    download: mocks.download,
    clipboardSupport: "supported",
    fit: "contain",
    frameKey: "1:41200",
    ...overrides,
  };
}

function renderActions(
  mocks: ActionMocks,
  overrides?: Partial<ReplayScreenshotActionsProps>,
): ReturnType<typeof render> {
  return render(<ReplayScreenshotActions {...makeProps(mocks, overrides)} />);
}

function rerenderActions(
  view: ReturnType<typeof render>,
  mocks: ActionMocks,
  overrides?: Partial<ReplayScreenshotActionsProps>,
): void {
  view.rerender(<ReplayScreenshotActions {...makeProps(mocks, overrides)} />);
}

function copyButton(): HTMLElement {
  return screen.getByTestId("replay-screenshot-copy");
}

function downloadButton(): HTMLElement {
  return screen.getByTestId("replay-screenshot-download");
}

function statusText(): string {
  return screen.getByTestId("replay-screenshot-status").textContent ?? "";
}

function errorCard(): HTMLElement {
  return screen.getByTestId("replay-screenshot-error");
}

function queryErrorCard(): HTMLElement | null {
  return screen.queryByTestId("replay-screenshot-error");
}

function previewCard(): HTMLElement {
  return screen.getByTestId("replay-screenshot-preview");
}

function queryPreviewCard(): HTMLElement | null {
  return screen.queryByTestId("replay-screenshot-preview");
}

function recoverButton(): HTMLElement {
  return screen.getByTestId("replay-screenshot-recover");
}

function advance(ms: number): void {
  act((): void => {
    jest.advanceTimersByTime(ms);
  });
}

function nextFrame(): void {
  advance(FRAME_MS);
}

async function flushMicrotasks(): Promise<void> {
  for (let tick: number = 0; tick < 25; tick++) {
    await Promise.resolve();
  }
}

/* Runs `run` (a resolve, a reject) and lets every promise chain settle. */
async function settle(run?: () => void): Promise<void> {
  await act(async (): Promise<void> => {
    if (run) {
      run();
    }

    await flushMicrotasks();
  });
}

/* Clicks a button and lets the capture it started finish. */
async function clickAndSettle(button: HTMLElement): Promise<void> {
  fireEvent.click(button);
  await settle();
}

interface ConsoleSpy {
  mock: { calls: Array<Array<unknown>> };
}

class FakeClipboardItem {
  public readonly items: Record<string, Promise<Blob> | Blob>;

  public constructor(items: Record<string, Promise<Blob> | Blob>) {
    this.items = items;
  }
}

function installClipboard(input: {
  write: MockFunction | null;
  isSecureContext: boolean;
}): void {
  Object.defineProperty(window, "isSecureContext", {
    value: input.isSecureContext,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "clipboard", {
    value: input.write ? { write: input.write } : undefined,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "ClipboardItem", {
    value: FakeClipboardItem,
    configurable: true,
    writable: true,
  });
}

function namedError(name: string, message: string): Error {
  const error: Error = new Error(message);

  error.name = name;

  return error;
}

let createObjectURL: MockFunction;
let revokeObjectURL: MockFunction;

beforeEach((): void => {
  jest.useFakeTimers();

  let created: number = 0;

  createObjectURL = getJestMockFunction();
  createObjectURL.mockImplementation((): string => {
    created += 1;

    return `blob:replay/${created}`;
  });
  revokeObjectURL = getJestMockFunction();

  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectURL,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revokeObjectURL,
    configurable: true,
    writable: true,
  });
});

afterEach((): void => {
  /* Unmounted while the fakes are still installed. */
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  Reflect.deleteProperty(window, "isSecureContext");
  Reflect.deleteProperty(window, "ClipboardItem");
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("describeReplayScreenshotFailure", () => {
  interface FailureCase<Reason> {
    reason: Reason;
    title: string;
    description: string;
  }

  const clipboardCases: Array<FailureCase<ReplayClipboardFailure>> = [
    {
      reason: "insecure-context",
      title: "Copying images needs HTTPS",
      description:
        "Browsers only let a secure (https) page put images on the clipboard. Download the PNG instead.",
    },
    {
      reason: "unsupported",
      title: "This browser can't copy images",
      description:
        "It has no image clipboard. Download the PNG instead - it is the same picture.",
    },
    {
      reason: "denied",
      title: "Clipboard access was blocked",
      description:
        "Allow clipboard access for this site in the browser, or download the PNG instead.",
    },
    {
      reason: "failed",
      title: "Couldn't copy the image",
      description: "The clipboard did not take it. Download the PNG instead.",
    },
  ];

  const captureCases: Array<FailureCase<ReplayFrameCaptureFailure>> = [
    {
      reason: "no-document",
      title: "The frame isn't ready yet",
      description:
        "The replay has not finished drawing this moment. Give it a second and try again.",
    },
    {
      reason: "empty-viewport",
      title: "The frame isn't ready yet",
      description:
        "The replay has not finished drawing this moment. Give it a second and try again.",
    },
    {
      reason: "encode-failed",
      title: "Couldn't save this frame",
      description: "The browser would not export the picture as a PNG.",
    },
    {
      reason: "render-failed",
      title: "Couldn't capture this frame",
      description: "The browser could not draw this recorded page as an image.",
    },
  ];

  clipboardCases.forEach(
    (testCase: FailureCase<ReplayClipboardFailure>): void => {
      it(`offers the download when the clipboard fails with ${testCase.reason}`, () => {
        const copy: ReplayScreenshotFailureCopy =
          describeReplayScreenshotFailure(
            new ReplayScreenshotClipboardError(testCase.reason, "message"),
          );

        expect(copy).toEqual({
          title: testCase.title,
          description: testCase.description,
          recovery: "download",
        });
      });
    },
  );

  captureCases.forEach(
    (testCase: FailureCase<ReplayFrameCaptureFailure>): void => {
      it(`offers a retry when the capture fails with ${testCase.reason}`, () => {
        const copy: ReplayScreenshotFailureCopy =
          describeReplayScreenshotFailure(
            new ReplayFrameCaptureError(testCase.reason, "message"),
          );

        expect(copy).toEqual({
          title: testCase.title,
          description: testCase.description,
          recovery: "retry",
        });
      });
    },
  );

  it("treats an unknown clipboard reason as a copy that did not take", () => {
    expect(
      describeReplayScreenshotFailure(
        new ReplayScreenshotClipboardError(
          "quota" as ReplayClipboardFailure,
          "message",
        ),
      ),
    ).toEqual({
      title: "Couldn't copy the image",
      description: "The clipboard did not take it. Download the PNG instead.",
      recovery: "download",
    });
  });

  it("treats an unknown capture reason as a frame that could not be drawn", () => {
    expect(
      describeReplayScreenshotFailure(
        new ReplayFrameCaptureError(
          "tainted" as ReplayFrameCaptureFailure,
          "message",
        ),
      ),
    ).toEqual({
      title: "Couldn't capture this frame",
      description: "The browser could not draw this recorded page as an image.",
      recovery: "retry",
    });
  });

  it("falls back to a generic retry for anything that is not a screenshot error", () => {
    const generic: ReplayScreenshotFailureCopy = {
      title: "Couldn't capture this frame",
      description: "Something went wrong while drawing the picture.",
      recovery: "retry",
    };
    const lookalike: Error = namedError(
      "ReplayScreenshotClipboardError",
      "denied",
    );

    expect(describeReplayScreenshotFailure(new Error("boom"))).toEqual(generic);
    expect(describeReplayScreenshotFailure("boom")).toEqual(generic);
    expect(describeReplayScreenshotFailure(null)).toEqual(generic);
    expect(describeReplayScreenshotFailure(undefined)).toEqual(generic);
    expect(describeReplayScreenshotFailure({ reason: "denied" })).toEqual(
      generic,
    );
    expect(describeReplayScreenshotFailure(lookalike)).toEqual(generic);
  });
});

describe("getReplayScreenshotDockPositionClassName", () => {
  it("keeps the dock clear of the scrollbars each fit can show", () => {
    expect(getReplayScreenshotDockPositionClassName("contain")).toBe(
      "bottom-3 right-3",
    );
    expect(getReplayScreenshotDockPositionClassName("width")).toBe(
      "bottom-3 right-6",
    );
    expect(getReplayScreenshotDockPositionClassName("actual")).toBe(
      "bottom-6 right-6",
    );
  });

  it("uses the contain corner when no fit is known", () => {
    expect(getReplayScreenshotDockPositionClassName(undefined)).toBe(
      "bottom-3 right-3",
    );
  });
});

describe("formatReplayScreenshotSize", () => {
  it("writes the size with a multiplication sign", () => {
    expect(formatReplayScreenshotSize(1440, 900)).toBe("1440 × 900");
  });

  it("rounds both sides to whole pixels", () => {
    expect(formatReplayScreenshotSize(1439.6, 899.5)).toBe("1440 × 900");
    expect(formatReplayScreenshotSize(1280.4, 719.49)).toBe("1280 × 719");
    expect(formatReplayScreenshotSize(390.5, 844.2)).toBe("391 × 844");
  });
});

describe("ReplayScreenshotActions", () => {
  describe("the dock", () => {
    it("offers Copy image and Download in a labelled group", () => {
      renderActions(makeMocks());

      const group: HTMLElement = screen.getByRole("group", {
        name: "Screenshot of this frame",
      });
      const copy: HTMLElement = within(group).getByRole("button", {
        name: "Copy image",
      });
      const download: HTMLElement = within(group).getByRole("button", {
        name: "Download",
      });

      expect(copy).toBe(copyButton());
      expect(download).toBe(downloadButton());
      expect(copy).toHaveAttribute("title", COPY_TITLE_SUPPORTED);
      expect(download).toHaveAttribute("title", "Download this frame as a PNG");
      expect(copy).toHaveAttribute("type", "button");
      expect(download).toHaveAttribute("type", "button");
      expect(copy).toHaveTextContent("Copy image");
      expect(download).toHaveTextContent("Download");
      expect(copy).toBeEnabled();
      expect(download).toBeEnabled();
      expect(copy).toHaveAttribute("data-state", "idle");
      expect(download).toHaveAttribute("data-state", "idle");
      expect(copy).not.toHaveAttribute("aria-busy");
      expect(download).not.toHaveAttribute("aria-busy");
    });

    it("says in the copy title why copying is unavailable", () => {
      const mocks: ActionMocks = makeMocks();
      const view: ReturnType<typeof render> = renderActions(mocks, {
        clipboardSupport: "insecure-context",
      });

      expect(copyButton()).toHaveAttribute("title", COPY_TITLE_INSECURE);

      rerenderActions(view, mocks, { clipboardSupport: "unsupported" });

      expect(copyButton()).toHaveAttribute("title", COPY_TITLE_UNSUPPORTED);
      /* Still offered: pressing it explains, and points at Download. */
      expect(copyButton()).toBeEnabled();
      expect(downloadButton()).toHaveAttribute(
        "title",
        "Download this frame as a PNG",
      );
    });

    it("reads the browser's clipboard support when none is passed", () => {
      const mocks: ActionMocks = makeMocks();
      const write: MockFunction = getJestMockFunction();

      const plain: ReturnType<typeof render> = renderActions(mocks, {
        clipboardSupport: undefined,
      });

      /* jsdom: no navigator.clipboard, no ClipboardItem. */
      expect(copyButton()).toHaveAttribute("title", COPY_TITLE_UNSUPPORTED);
      plain.unmount();

      installClipboard({ write: write, isSecureContext: false });

      const insecure: ReturnType<typeof render> = renderActions(mocks, {
        clipboardSupport: undefined,
      });

      expect(copyButton()).toHaveAttribute("title", COPY_TITLE_INSECURE);
      insecure.unmount();

      installClipboard({ write: write, isSecureContext: true });
      renderActions(mocks, { clipboardSupport: undefined });

      expect(copyButton()).toHaveAttribute("title", COPY_TITLE_SUPPORTED);
    });

    it("fades the dock in on the next animation frame", () => {
      renderActions(makeMocks());

      const group: HTMLElement = screen.getByTestId(
        "replay-screenshot-actions",
      );

      expect(group).toHaveClass("translate-y-1", "opacity-0");
      expect(group).not.toHaveClass("opacity-100");

      nextFrame();

      expect(group).toHaveClass("translate-y-0", "opacity-100");
      expect(group).not.toHaveClass("opacity-0");
      expect(group).not.toHaveClass("translate-y-1");
    });

    it("sits clear of the scrollbars of the current fit", () => {
      const mocks: ActionMocks = makeMocks();
      const view: ReturnType<typeof render> = renderActions(mocks, {
        fit: "contain",
      });
      const root: HTMLElement = screen.getByTestId("replay-screenshot");

      expect(root).toHaveClass("absolute", "bottom-3", "right-3");

      rerenderActions(view, mocks, { fit: "width" });
      expect(root).toHaveClass("bottom-3", "right-6");
      expect(root).not.toHaveClass("right-3");

      rerenderActions(view, mocks, { fit: "actual" });
      expect(root).toHaveClass("bottom-6", "right-6");
      expect(root).not.toHaveClass("bottom-3");

      rerenderActions(view, mocks, { fit: undefined });
      expect(root).toHaveClass("bottom-3", "right-3");
    });

    it("lets clicks through to the stage everywhere but the buttons", () => {
      renderActions(makeMocks());

      expect(screen.getByTestId("replay-screenshot")).toHaveClass(
        "pointer-events-none",
      );
      expect(screen.getByTestId("replay-screenshot-actions")).toHaveClass(
        "pointer-events-auto",
      );
    });

    it("shows no card, flash or announcement before anything is captured", () => {
      const mocks: ActionMocks = makeMocks();

      renderActions(mocks);
      nextFrame();

      expect(queryErrorCard()).not.toBeInTheDocument();
      expect(queryPreviewCard()).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("replay-screenshot-flash"),
      ).not.toBeInTheDocument();
      expect(statusText()).toBe("");
      expect(screen.getByTestId("replay-screenshot-status")).toHaveAttribute(
        "aria-live",
        "polite",
      );
      expect(screen.getByRole("status")).toHaveClass("sr-only");
      expect(mocks.onCapture).not.toHaveBeenCalled();
      expect(createObjectURL).not.toHaveBeenCalled();
    });
  });

  describe("copy image", () => {
    it("hands the clipboard the pending image synchronously inside the click", async () => {
      const mocks: ActionMocks = makeMocks();
      const capture: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();
      const shot: ReplayScreenshot = makeScreenshot();

      mocks.onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
        return capture.promise;
      });
      renderActions(mocks);

      fireEvent.click(copyButton());

      /* Nothing has been awaited: the capture is still running. */
      expect(mocks.onCapture).toHaveBeenCalledTimes(1);
      expect(mocks.copyToClipboard).toHaveBeenCalledTimes(1);
      expect(mocks.onCapture.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.copyToClipboard.mock.invocationCallOrder[0] as number,
      );

      const image: unknown = mocks.copyToClipboard.mock.calls[0]?.[0];

      expect(image).toBeInstanceOf(Promise);

      await settle((): void => {
        capture.resolve(shot);
      });

      /* The clipboard gets the PNG itself, not the screenshot record. */
      await expect(image as Promise<Blob>).resolves.toBe(shot.blob);
      expect(mocks.copyToClipboard).toHaveBeenCalledTimes(1);
      expect(mocks.download).not.toHaveBeenCalled();
    });

    it("spins the pressed button and marks both unavailable while the frame is drawn, without taking focus away", async () => {
      const mocks: ActionMocks = makeMocks();
      const capture: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();

      mocks.onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
        return capture.promise;
      });
      renderActions(mocks);

      copyButton().focus();
      fireEvent.click(copyButton());

      /*
       * aria-disabled, not disabled: a disabled button drops the keyboard
       * focus to <body>, where the next Space plays the replay.
       */
      expect(copyButton()).toBeEnabled();
      expect(copyButton()).toHaveAttribute("aria-disabled", "true");
      expect(downloadButton()).toHaveAttribute("aria-disabled", "true");
      expect(copyButton()).toHaveFocus();
      expect(copyButton()).toHaveAttribute("aria-busy", "true");
      expect(copyButton()).toHaveAttribute("data-state", "busy");
      expect(copyButton().querySelector(".animate-spin")).not.toBeNull();
      expect(downloadButton()).not.toHaveAttribute("aria-busy");
      expect(downloadButton()).toHaveAttribute("data-state", "idle");
      expect(downloadButton().querySelector(".animate-spin")).toBeNull();
      expect(queryPreviewCard()).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("replay-screenshot-flash"),
      ).not.toBeInTheDocument();
      expect(statusText()).toBe("");

      await settle((): void => {
        capture.resolve(makeScreenshot());
      });

      expect(copyButton()).not.toHaveAttribute("aria-disabled");
      expect(downloadButton()).not.toHaveAttribute("aria-disabled");
      expect(copyButton()).not.toHaveAttribute("aria-busy");
      expect(copyButton()).toHaveFocus();
      expect(copyButton().querySelector(".animate-spin")).toBeNull();
    });

    it("waits for the clipboard write as well as the capture", async () => {
      const mocks: ActionMocks = makeMocks();
      const write: Deferred<void> = makeDeferred<void>();

      mocks.copyToClipboard.mockImplementation(
        (image: Promise<Blob>): Promise<void> => {
          image.catch(ignoreRejection);

          return write.promise;
        },
      );
      renderActions(mocks);

      await clickAndSettle(copyButton());

      /* The frame is drawn; the clipboard has not answered yet. */
      expect(copyButton()).toHaveAttribute("data-state", "busy");
      expect(queryPreviewCard()).not.toBeInTheDocument();

      await settle((): void => {
        write.resolve();
      });

      expect(copyButton()).toHaveAttribute("data-state", "done");
      expect(previewCard()).toHaveAttribute("data-action", "copy");
    });

    it("confirms the copy with a thumbnail, the size and an announcement", async () => {
      const shot: ReplayScreenshot = makeScreenshot();
      const mocks: ActionMocks = makeMocks(shot);

      renderActions(mocks);
      nextFrame();

      await clickAndSettle(copyButton());

      expect(copyButton()).toHaveAttribute("data-state", "done");
      expect(copyButton()).not.toHaveAttribute("aria-busy");
      expect(copyButton().querySelector(".text-emerald-300")).not.toBeNull();
      expect(downloadButton()).toHaveAttribute("data-state", "idle");

      const card: HTMLElement = previewCard();

      expect(card).toHaveAttribute("data-action", "copy");
      expect(card).toHaveTextContent("Copied to clipboard");

      const detail: HTMLElement = screen.getByTestId(
        "replay-screenshot-preview-detail",
      );

      expect(detail).toHaveTextContent("1440 × 900 PNG");
      expect(detail).toHaveAttribute("title", FILE_NAME);

      const thumbnail: HTMLImageElement = screen.getByTestId(
        "replay-screenshot-thumbnail",
      ) as HTMLImageElement;

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(createObjectURL).toHaveBeenCalledWith(shot.blob);
      expect(thumbnail).toHaveAttribute("src", "blob:replay/1");
      expect(thumbnail).toHaveAttribute("alt", "The captured frame");
      expect(thumbnail.style.aspectRatio).toBe("1440 / 900");

      expect(statusText()).toBe("Screenshot copied to the clipboard.");
      expect(screen.getByTestId("replay-screenshot-flash")).toBeInTheDocument();
      expect(queryErrorCard()).not.toBeInTheDocument();
      expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    it("flashes the stage at full brightness, then fades the flash out", async () => {
      renderActions(makeMocks());
      nextFrame();

      await clickAndSettle(copyButton());

      const flash: HTMLElement = screen.getByTestId("replay-screenshot-flash");

      expect(flash).toHaveAttribute("aria-hidden", "true");
      expect(flash).toHaveClass("opacity-60", "motion-reduce:hidden");
      expect(flash).not.toHaveClass("transition-opacity");

      /* Held for a painted frame: one frame is not enough to fade from. */
      nextFrame();
      expect(screen.getByTestId("replay-screenshot-flash")).toHaveClass(
        "opacity-60",
      );

      nextFrame();
      expect(screen.getByTestId("replay-screenshot-flash")).toHaveClass(
        "opacity-0",
        "transition-opacity",
      );
      expect(screen.getByTestId("replay-screenshot-flash")).not.toHaveClass(
        "opacity-60",
      );

      advance(REPLAY_SCREENSHOT_FLASH_MS - 1);
      expect(screen.getByTestId("replay-screenshot-flash")).toBeInTheDocument();

      advance(1);
      expect(
        screen.queryByTestId("replay-screenshot-flash"),
      ).not.toBeInTheDocument();
    });

    it("puts the button back to idle after the done interval", async () => {
      renderActions(makeMocks());

      await clickAndSettle(copyButton());

      advance(REPLAY_SCREENSHOT_DONE_MS - 1);
      expect(copyButton()).toHaveAttribute("data-state", "done");

      advance(1);
      expect(copyButton()).toHaveAttribute("data-state", "idle");
      expect(copyButton().querySelector(".text-emerald-300")).toBeNull();
      /* The card outlives the check mark. */
      expect(previewCard()).toBeInTheDocument();
      expect(statusText()).toBe("Screenshot copied to the clipboard.");
    });

    it("takes the card away after the preview interval and revokes its thumbnail", async () => {
      renderActions(makeMocks());

      await clickAndSettle(copyButton());

      advance(REPLAY_SCREENSHOT_PREVIEW_MS - 1);
      expect(previewCard()).toBeInTheDocument();
      expect(revokeObjectURL).not.toHaveBeenCalled();

      advance(1);
      expect(queryPreviewCard()).not.toBeInTheDocument();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:replay/1");
    });

    it("rounds a fractional recorded viewport on the card", async () => {
      renderActions(
        makeMocks(makeScreenshot({ width: 1439.6, height: 899.5 })),
      );

      await clickAndSettle(copyButton());

      expect(
        screen.getByTestId("replay-screenshot-preview-detail"),
      ).toHaveTextContent("1440 × 900 PNG");
      expect(
        (screen.getByTestId("replay-screenshot-thumbnail") as HTMLImageElement)
          .style.aspectRatio,
      ).toBe("1439.6 / 899.5");
    });

    it("confirms without a thumbnail when the browser has no object URLs", async () => {
      Reflect.deleteProperty(URL, "createObjectURL");
      renderActions(makeMocks());

      await clickAndSettle(copyButton());

      expect(previewCard()).toHaveTextContent("Copied to clipboard");
      expect(
        screen.queryByTestId("replay-screenshot-thumbnail"),
      ).not.toBeInTheDocument();

      advance(REPLAY_SCREENSHOT_PREVIEW_MS);
      expect(queryPreviewCard()).not.toBeInTheDocument();
      expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    it("confirms without a thumbnail when making the object URL throws", async () => {
      createObjectURL.mockImplementation((): string => {
        throw new Error("Blob URLs are disabled");
      });
      renderActions(makeMocks());

      await clickAndSettle(copyButton());

      expect(previewCard()).toHaveAttribute("data-action", "copy");
      expect(
        screen.queryByTestId("replay-screenshot-thumbnail"),
      ).not.toBeInTheDocument();
      expect(statusText()).toBe("Screenshot copied to the clipboard.");
    });
  });

  describe("download", () => {
    it("saves the captured screenshot and names the file on the card", async () => {
      const shot: ReplayScreenshot = makeScreenshot();
      const mocks: ActionMocks = makeMocks(shot);

      renderActions(mocks);

      fireEvent.click(downloadButton());
      /* Saved once the frame is drawn, not before. */
      expect(mocks.download).not.toHaveBeenCalled();

      await settle();

      expect(mocks.onCapture).toHaveBeenCalledTimes(1);
      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(mocks.download.mock.calls[0]?.[0]).toBe(shot);
      expect(mocks.copyToClipboard).not.toHaveBeenCalled();

      expect(downloadButton()).toHaveAttribute("data-state", "done");
      expect(copyButton()).toHaveAttribute("data-state", "idle");

      const card: HTMLElement = previewCard();

      expect(card).toHaveAttribute("data-action", "download");
      expect(card).toHaveTextContent("Screenshot downloaded");
      expect(card).not.toHaveTextContent("Copied to clipboard");

      const detail: HTMLElement = screen.getByTestId(
        "replay-screenshot-preview-detail",
      );

      expect(detail).toHaveTextContent(FILE_NAME);
      expect(detail).toHaveAttribute("title", FILE_NAME);
      expect(detail).not.toHaveTextContent("PNG");
      expect(screen.getByTestId("replay-screenshot-thumbnail")).toHaveAttribute(
        "src",
        "blob:replay/1",
      );
      expect(screen.getByTestId("replay-screenshot-flash")).toBeInTheDocument();
    });

    it("announces the file name", async () => {
      renderActions(makeMocks());

      await clickAndSettle(downloadButton());

      expect(statusText()).toBe(`Screenshot downloaded as ${FILE_NAME}.`);
    });

    it("spins the Download button while the frame is drawn", async () => {
      const mocks: ActionMocks = makeMocks();
      const capture: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();

      mocks.onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
        return capture.promise;
      });
      renderActions(mocks);

      fireEvent.click(downloadButton());

      expect(downloadButton()).toHaveAttribute("data-state", "busy");
      expect(downloadButton()).toHaveAttribute("aria-busy", "true");
      expect(downloadButton()).toHaveAttribute("aria-disabled", "true");
      expect(copyButton()).toHaveAttribute("aria-disabled", "true");
      expect(copyButton()).toHaveAttribute("data-state", "idle");
      expect(copyButton()).not.toHaveAttribute("aria-busy");

      await settle((): void => {
        capture.resolve(makeScreenshot());
      });

      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(downloadButton()).toHaveAttribute("data-state", "done");
      expect(downloadButton()).toBeEnabled();

      advance(REPLAY_SCREENSHOT_DONE_MS);
      expect(downloadButton()).toHaveAttribute("data-state", "idle");
    });
  });

  describe("one capture at a time", () => {
    it("ignores a second click on the same button in the same frame", async () => {
      const mocks: ActionMocks = makeMocks();

      renderActions(mocks);

      /* Both clicks land before React re-renders the busy state. */
      act((): void => {
        fireEvent.click(copyButton());
        /* Only the busy guard stands in the way. */
        expect(copyButton()).toBeEnabled();
        fireEvent.click(copyButton());
      });

      await settle();

      expect(mocks.onCapture).toHaveBeenCalledTimes(1);
      expect(mocks.copyToClipboard).toHaveBeenCalledTimes(1);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });

    it("ignores the other button while a capture is running", async () => {
      const mocks: ActionMocks = makeMocks();

      renderActions(mocks);

      act((): void => {
        fireEvent.click(downloadButton());
        expect(copyButton()).toBeEnabled();
        fireEvent.click(copyButton());
      });

      await settle();

      expect(mocks.onCapture).toHaveBeenCalledTimes(1);
      expect(mocks.copyToClipboard).not.toHaveBeenCalled();
      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(previewCard()).toHaveAttribute("data-action", "download");
    });

    it("does not start a capture from a button marked busy", async () => {
      const mocks: ActionMocks = makeMocks();
      const capture: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();

      mocks.onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
        return capture.promise;
      });
      renderActions(mocks);

      fireEvent.click(copyButton());
      fireEvent.click(downloadButton());
      fireEvent.click(copyButton());

      expect(mocks.onCapture).toHaveBeenCalledTimes(1);
      expect(mocks.copyToClipboard).toHaveBeenCalledTimes(1);

      await settle((): void => {
        capture.resolve(makeScreenshot());
      });

      expect(mocks.download).not.toHaveBeenCalled();
      expect(previewCard()).toHaveAttribute("data-action", "copy");
    });

    it("accepts the next capture as soon as the last one finished", async () => {
      const mocks: ActionMocks = makeMocks();

      renderActions(mocks);

      await clickAndSettle(copyButton());
      await clickAndSettle(downloadButton());
      await clickAndSettle(copyButton());

      expect(mocks.onCapture).toHaveBeenCalledTimes(3);
      expect(mocks.copyToClipboard).toHaveBeenCalledTimes(2);
      expect(mocks.download).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the clipboard cannot take images", () => {
    it("says so at once, without capturing, and offers the download", () => {
      const mocks: ActionMocks = makeMocks();

      renderActions(mocks, { clipboardSupport: "unsupported" });

      fireEvent.click(copyButton());

      const card: HTMLElement = screen.getByRole("alert");

      expect(card).toBe(errorCard());
      expect(card).toHaveAttribute("data-recovery", "download");
      expect(card).toHaveTextContent("This browser can't copy images");
      expect(card).toHaveTextContent(
        "It has no image clipboard. Download the PNG instead - it is the same picture.",
      );
      expect(recoverButton()).toHaveTextContent("Download instead");
      expect(mocks.onCapture).not.toHaveBeenCalled();
      expect(mocks.copyToClipboard).not.toHaveBeenCalled();
      expect(mocks.download).not.toHaveBeenCalled();

      /* Nothing is running, so nothing is busy. */
      expect(copyButton()).toBeEnabled();
      expect(downloadButton()).toBeEnabled();
      expect(copyButton()).toHaveAttribute("data-state", "idle");
      expect(statusText()).toBe("");
    });

    it("says HTTPS is needed on an insecure page", () => {
      const mocks: ActionMocks = makeMocks();

      renderActions(mocks, { clipboardSupport: "insecure-context" });

      fireEvent.click(copyButton());

      expect(errorCard()).toHaveAttribute("data-recovery", "download");
      expect(errorCard()).toHaveTextContent("Copying images needs HTTPS");
      expect(errorCard()).toHaveTextContent(
        "Browsers only let a secure (https) page put images on the clipboard.",
      );
      expect(mocks.onCapture).not.toHaveBeenCalled();
      expect(mocks.copyToClipboard).not.toHaveBeenCalled();
    });

    it("captures and saves the frame from Download instead", async () => {
      const shot: ReplayScreenshot = makeScreenshot();
      const mocks: ActionMocks = makeMocks(shot);
      const capture: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();

      mocks.onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
        return capture.promise;
      });
      renderActions(mocks, { clipboardSupport: "unsupported" });

      fireEvent.click(copyButton());
      fireEvent.click(recoverButton());

      /* The card goes while the frame is drawn. */
      expect(queryErrorCard()).not.toBeInTheDocument();
      expect(mocks.onCapture).toHaveBeenCalledTimes(1);
      expect(downloadButton()).toHaveAttribute("data-state", "busy");

      await settle((): void => {
        capture.resolve(shot);
      });

      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(mocks.download.mock.calls[0]?.[0]).toBe(shot);
      expect(mocks.copyToClipboard).not.toHaveBeenCalled();
      expect(previewCard()).toHaveAttribute("data-action", "download");
      expect(statusText()).toBe(`Screenshot downloaded as ${FILE_NAME}.`);
    });
  });

  describe("when the clipboard refuses the image", () => {
    function refuseAfterCapture(
      mocks: ActionMocks,
      reason: ReplayClipboardFailure,
    ): void {
      mocks.copyToClipboard.mockImplementation(
        async (image: Promise<Blob>): Promise<void> => {
          await image;

          throw new ReplayScreenshotClipboardError(reason, "refused");
        },
      );
    }

    it("offers to save the PNG that was already drawn, without drawing it again", async () => {
      const shot: ReplayScreenshot = makeScreenshot();
      const mocks: ActionMocks = makeMocks(shot);

      refuseAfterCapture(mocks, "denied");
      renderActions(mocks);

      await clickAndSettle(copyButton());

      expect(errorCard()).toHaveAttribute("data-recovery", "download");
      expect(errorCard()).toHaveTextContent("Clipboard access was blocked");
      expect(errorCard()).toHaveTextContent(
        "Allow clipboard access for this site in the browser, or download the PNG instead.",
      );
      expect(copyButton()).toHaveAttribute("data-state", "idle");
      expect(copyButton()).toBeEnabled();
      expect(queryPreviewCard()).not.toBeInTheDocument();
      expect(statusText()).toBe("");
      expect(createObjectURL).not.toHaveBeenCalled();

      fireEvent.click(recoverButton());

      /* Saved inside this click - no capture to wait for. */
      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(mocks.download.mock.calls[0]?.[0]).toBe(shot);
      expect(mocks.onCapture).toHaveBeenCalledTimes(1);
      expect(queryErrorCard()).not.toBeInTheDocument();
      expect(previewCard()).toHaveAttribute("data-action", "download");
      expect(downloadButton()).toHaveAttribute("data-state", "done");
      expect(statusText()).toBe(`Screenshot downloaded as ${FILE_NAME}.`);
    });

    const refusalTitles: Array<{
      reason: ReplayClipboardFailure;
      title: string;
    }> = [
      { reason: "denied", title: "Clipboard access was blocked" },
      { reason: "failed", title: "Couldn't copy the image" },
      { reason: "unsupported", title: "This browser can't copy images" },
      { reason: "insecure-context", title: "Copying images needs HTTPS" },
    ];

    refusalTitles.forEach(
      (testCase: { reason: ReplayClipboardFailure; title: string }): void => {
        it(`names a ${testCase.reason} clipboard and offers the download`, async () => {
          const mocks: ActionMocks = makeMocks();

          refuseAfterCapture(mocks, testCase.reason);
          renderActions(mocks);

          await clickAndSettle(copyButton());

          expect(errorCard()).toHaveTextContent(testCase.title);
          expect(errorCard()).toHaveAttribute("data-recovery", "download");
          expect(recoverButton()).toHaveTextContent("Download instead");
        });
      },
    );

    it("draws the frame afresh from Download instead when the clipboard failed before it was drawn", async () => {
      const second: ReplayScreenshot = makeScreenshot({
        fileName: "session-replay-3f9a2c1b-0m41.3s.png",
      });
      const mocks: ActionMocks = makeMocks(second);
      const firstCapture: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();

      mocks.onCapture.mockImplementationOnce((): Promise<ReplayScreenshot> => {
        return firstCapture.promise;
      });
      mocks.copyToClipboard.mockImplementation(
        (image: Promise<Blob>): Promise<void> => {
          image.catch(ignoreRejection);

          return Promise.reject(
            new ReplayScreenshotClipboardError("failed", "no clipboard"),
          );
        },
      );
      renderActions(mocks);

      await clickAndSettle(copyButton());

      expect(errorCard()).toHaveTextContent("Couldn't copy the image");

      await clickAndSettle(recoverButton());

      expect(mocks.onCapture).toHaveBeenCalledTimes(2);
      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(mocks.download.mock.calls[0]?.[0]).toBe(second);
      expect(previewCard()).toHaveTextContent(
        "session-replay-3f9a2c1b-0m41.3s.png",
      );
    });
  });

  describe("when the frame cannot be captured", () => {
    const captureFailures: Array<{
      reason: ReplayFrameCaptureFailure;
      title: string;
      description: string;
    }> = [
      {
        reason: "render-failed",
        title: "Couldn't capture this frame",
        description:
          "The browser could not draw this recorded page as an image.",
      },
      {
        reason: "no-document",
        title: "The frame isn't ready yet",
        description: "Give it a second and try again.",
      },
      {
        reason: "empty-viewport",
        title: "The frame isn't ready yet",
        description: "Give it a second and try again.",
      },
      {
        reason: "encode-failed",
        title: "Couldn't save this frame",
        description: "The browser would not export the picture as a PNG.",
      },
    ];

    const actions: Array<"copy" | "download"> = ["copy", "download"];

    actions.forEach((action: "copy" | "download"): void => {
      captureFailures.forEach(
        (testCase: {
          reason: ReplayFrameCaptureFailure;
          title: string;
          description: string;
        }): void => {
          it(`says what went wrong when a ${action}'s capture fails with ${testCase.reason}`, async () => {
            const mocks: ActionMocks = makeMocks();

            mocks.onCapture.mockImplementation(
              (): Promise<ReplayScreenshot> => {
                return Promise.reject(
                  new ReplayFrameCaptureError(testCase.reason, "capture"),
                );
              },
            );
            renderActions(mocks);

            await clickAndSettle(
              action === "copy" ? copyButton() : downloadButton(),
            );

            const card: HTMLElement = screen.getByRole("alert");

            expect(card).toHaveAttribute("data-recovery", "retry");
            expect(card).toHaveTextContent(testCase.title);
            expect(card).toHaveTextContent(testCase.description);
            expect(recoverButton()).toHaveTextContent("Try again");
            expect(queryPreviewCard()).not.toBeInTheDocument();
            expect(mocks.download).not.toHaveBeenCalled();
            expect(copyButton()).toHaveAttribute("data-state", "idle");
            expect(downloadButton()).toHaveAttribute("data-state", "idle");
            expect(copyButton()).toBeEnabled();
            expect(downloadButton()).toBeEnabled();
            expect(statusText()).toBe("");
            expect(createObjectURL).not.toHaveBeenCalled();
            expect(
              screen.queryByTestId("replay-screenshot-flash"),
            ).not.toBeInTheDocument();
          });
        },
      );
    });

    it("copies again from Try again", async () => {
      const mocks: ActionMocks = makeMocks();

      mocks.onCapture.mockImplementationOnce((): Promise<ReplayScreenshot> => {
        return Promise.reject(
          new ReplayFrameCaptureError("render-failed", "capture"),
        );
      });
      renderActions(mocks);

      await clickAndSettle(copyButton());

      expect(errorCard()).toHaveAttribute("data-recovery", "retry");

      await clickAndSettle(recoverButton());

      expect(mocks.onCapture).toHaveBeenCalledTimes(2);
      expect(mocks.copyToClipboard).toHaveBeenCalledTimes(2);
      expect(mocks.download).not.toHaveBeenCalled();
      expect(queryErrorCard()).not.toBeInTheDocument();
      expect(previewCard()).toHaveAttribute("data-action", "copy");
      expect(statusText()).toBe("Screenshot copied to the clipboard.");
    });

    it("downloads again from Try again", async () => {
      const shot: ReplayScreenshot = makeScreenshot();
      const mocks: ActionMocks = makeMocks(shot);

      mocks.onCapture.mockImplementationOnce((): Promise<ReplayScreenshot> => {
        return Promise.reject(
          new ReplayFrameCaptureError("no-document", "capture"),
        );
      });
      renderActions(mocks);

      await clickAndSettle(downloadButton());

      expect(errorCard()).toHaveTextContent("The frame isn't ready yet");

      await clickAndSettle(recoverButton());

      expect(mocks.onCapture).toHaveBeenCalledTimes(2);
      expect(mocks.copyToClipboard).not.toHaveBeenCalled();
      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(mocks.download.mock.calls[0]?.[0]).toBe(shot);
      expect(previewCard()).toHaveAttribute("data-action", "download");
    });

    it("reports a capture that throws instead of rejecting", async () => {
      const mocks: ActionMocks = makeMocks();

      mocks.onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
        throw new Error("replayer is gone");
      });
      renderActions(mocks);

      await clickAndSettle(downloadButton());

      expect(errorCard()).toHaveAttribute("data-recovery", "retry");
      expect(errorCard()).toHaveTextContent("Couldn't capture this frame");
      expect(errorCard()).toHaveTextContent(
        "Something went wrong while drawing the picture.",
      );
      expect(downloadButton()).toBeEnabled();

      await clickAndSettle(copyButton());

      /* The clipboard is still handed the (rejected) image in the click. */
      expect(mocks.copyToClipboard).toHaveBeenCalledTimes(1);
      expect(errorCard()).toHaveTextContent("Couldn't capture this frame");
      expect(copyButton()).toBeEnabled();
    });

    it("fails the copy when the capture fails after the clipboard accepted the promise", async () => {
      const mocks: ActionMocks = makeMocks();

      mocks.onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
        return Promise.reject(
          new ReplayFrameCaptureError("encode-failed", "capture"),
        );
      });
      mocks.copyToClipboard.mockImplementation(
        (image: Promise<Blob>): Promise<void> => {
          image.catch(ignoreRejection);

          return Promise.resolve();
        },
      );
      renderActions(mocks);

      await clickAndSettle(copyButton());

      expect(errorCard()).toHaveTextContent("Couldn't save this frame");
      expect(errorCard()).toHaveAttribute("data-recovery", "retry");
      expect(queryPreviewCard()).not.toBeInTheDocument();
      expect(statusText()).toBe("");
    });
  });

  describe("when the download fails", () => {
    it("shows a retry card when saving the file throws", async () => {
      const mocks: ActionMocks = makeMocks();

      mocks.download.mockImplementationOnce((): void => {
        throw new Error("Downloads are blocked");
      });
      renderActions(mocks);

      await clickAndSettle(downloadButton());

      expect(errorCard()).toHaveAttribute("data-recovery", "retry");
      expect(errorCard()).toHaveTextContent("Couldn't capture this frame");
      expect(downloadButton()).toHaveAttribute("data-state", "idle");
      expect(downloadButton()).toBeEnabled();
      expect(queryPreviewCard()).not.toBeInTheDocument();
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(statusText()).toBe("");

      await clickAndSettle(recoverButton());

      expect(mocks.onCapture).toHaveBeenCalledTimes(2);
      expect(mocks.download).toHaveBeenCalledTimes(2);
      expect(previewCard()).toHaveAttribute("data-action", "download");
    });

    it("shows a retry card when Download instead throws", async () => {
      const mocks: ActionMocks = makeMocks();

      mocks.copyToClipboard.mockImplementation(
        async (image: Promise<Blob>): Promise<void> => {
          await image;

          throw new ReplayScreenshotClipboardError("denied", "refused");
        },
      );
      mocks.download.mockImplementationOnce((): void => {
        throw new Error("Downloads are blocked");
      });
      renderActions(mocks);

      await clickAndSettle(copyButton());

      fireEvent.click(recoverButton());

      expect(errorCard()).toHaveAttribute("data-recovery", "retry");
      expect(errorCard()).toHaveTextContent("Couldn't capture this frame");
      expect(queryPreviewCard()).not.toBeInTheDocument();

      /* The retry is the download's: it draws and saves afresh. */
      await clickAndSettle(recoverButton());

      expect(mocks.onCapture).toHaveBeenCalledTimes(2);
      expect(mocks.copyToClipboard).toHaveBeenCalledTimes(1);
      expect(mocks.download).toHaveBeenCalledTimes(2);
      expect(previewCard()).toHaveAttribute("data-action", "download");
    });
  });

  describe("cards", () => {
    it("takes the error card away while the next capture runs", async () => {
      const mocks: ActionMocks = makeMocks();
      const capture: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();

      mocks.onCapture.mockImplementationOnce((): Promise<ReplayScreenshot> => {
        return Promise.reject(
          new ReplayFrameCaptureError("render-failed", "capture"),
        );
      });
      renderActions(mocks);

      await clickAndSettle(downloadButton());
      expect(errorCard()).toBeInTheDocument();

      mocks.onCapture.mockImplementationOnce((): Promise<ReplayScreenshot> => {
        return capture.promise;
      });
      fireEvent.click(downloadButton());

      expect(queryErrorCard()).not.toBeInTheDocument();
      expect(downloadButton()).toHaveAttribute("data-state", "busy");

      await settle((): void => {
        capture.resolve(makeScreenshot());
      });

      expect(previewCard()).toBeInTheDocument();
    });

    it("replaces the success card with a failure and revokes its thumbnail", async () => {
      const mocks: ActionMocks = makeMocks();

      renderActions(mocks);

      await clickAndSettle(copyButton());
      expect(previewCard()).toBeInTheDocument();
      expect(copyButton()).toHaveAttribute("data-state", "done");

      mocks.onCapture.mockImplementationOnce((): Promise<ReplayScreenshot> => {
        return Promise.reject(
          new ReplayFrameCaptureError("render-failed", "capture"),
        );
      });

      await clickAndSettle(downloadButton());

      expect(queryPreviewCard()).not.toBeInTheDocument();
      expect(errorCard()).toBeInTheDocument();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:replay/1");
      /* The copy's check mark does not survive a failure either. */
      expect(copyButton()).toHaveAttribute("data-state", "idle");
      expect(statusText()).toBe("");

      /* The old card's timer is gone: it does not revoke a second time. */
      advance(REPLAY_SCREENSHOT_PREVIEW_MS);
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(errorCard()).toBeInTheDocument();
    });

    it("replaces the previous success card, revokes its thumbnail and restarts the timers", async () => {
      const first: ReplayScreenshot = makeScreenshot();
      const second: ReplayScreenshot = makeScreenshot({
        fileName: "session-replay-3f9a2c1b-0m41.3s.png",
      });
      const mocks: ActionMocks = makeMocks(first);

      mocks.onCapture
        .mockImplementationOnce((): Promise<ReplayScreenshot> => {
          return Promise.resolve(first);
        })
        .mockImplementationOnce((): Promise<ReplayScreenshot> => {
          return Promise.resolve(second);
        });
      renderActions(mocks);

      await clickAndSettle(copyButton());
      expect(screen.getByTestId("replay-screenshot-thumbnail")).toHaveAttribute(
        "src",
        "blob:replay/1",
      );

      advance(REPLAY_SCREENSHOT_DONE_MS / 2);

      await clickAndSettle(downloadButton());

      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:replay/1");
      expect(screen.getAllByTestId("replay-screenshot-preview")).toHaveLength(
        1,
      );
      expect(previewCard()).toHaveAttribute("data-action", "download");
      expect(previewCard()).toHaveTextContent(
        "session-replay-3f9a2c1b-0m41.3s.png",
      );
      expect(screen.getByTestId("replay-screenshot-thumbnail")).toHaveAttribute(
        "src",
        "blob:replay/2",
      );
      expect(copyButton()).toHaveAttribute("data-state", "idle");
      expect(downloadButton()).toHaveAttribute("data-state", "done");

      /* The first capture's timers would have fired inside this window. */
      advance(REPLAY_SCREENSHOT_DONE_MS - 1);
      expect(downloadButton()).toHaveAttribute("data-state", "done");

      advance(REPLAY_SCREENSHOT_PREVIEW_MS - REPLAY_SCREENSHOT_DONE_MS);
      expect(previewCard()).toBeInTheDocument();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);

      advance(1);
      expect(queryPreviewCard()).not.toBeInTheDocument();
      expect(revokeObjectURL).toHaveBeenCalledTimes(2);
      expect(revokeObjectURL).toHaveBeenLastCalledWith("blob:replay/2");
    });

    it("dismisses the success card and revokes its thumbnail", async () => {
      renderActions(makeMocks());

      await clickAndSettle(copyButton());

      const dismiss: HTMLElement = within(previewCard()).getByRole("button", {
        name: "Dismiss",
      });

      expect(dismiss).toBe(
        screen.getByTestId("replay-screenshot-preview-dismiss"),
      );

      fireEvent.click(dismiss);

      expect(queryPreviewCard()).not.toBeInTheDocument();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:replay/1");

      /* Its timer went with it. */
      advance(REPLAY_SCREENSHOT_PREVIEW_MS);
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    });

    it("survives a thumbnail URL that is already gone", async () => {
      revokeObjectURL.mockImplementation((): void => {
        throw new Error("Already revoked");
      });
      renderActions(makeMocks());

      await clickAndSettle(copyButton());

      fireEvent.click(screen.getByTestId("replay-screenshot-preview-dismiss"));

      expect(queryPreviewCard()).not.toBeInTheDocument();
      expect(copyButton()).toBeEnabled();
    });

    it("dismisses the error card", async () => {
      const mocks: ActionMocks = makeMocks();

      renderActions(mocks, { clipboardSupport: "unsupported" });

      fireEvent.click(copyButton());

      const dismiss: HTMLElement = within(errorCard()).getByRole("button", {
        name: "Dismiss",
      });

      expect(dismiss).toBe(
        screen.getByTestId("replay-screenshot-error-dismiss"),
      );

      fireEvent.click(dismiss);

      expect(queryErrorCard()).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(mocks.onCapture).not.toHaveBeenCalled();

      await clickAndSettle(downloadButton());

      expect(previewCard()).toHaveAttribute("data-action", "download");
    });

    it("shows the error card instead of a success card, never both", async () => {
      const mocks: ActionMocks = makeMocks();
      const view: ReturnType<typeof render> = renderActions(mocks);

      await clickAndSettle(downloadButton());
      expect(previewCard()).toBeInTheDocument();

      rerenderActions(view, mocks, { clipboardSupport: "unsupported" });
      fireEvent.click(copyButton());

      expect(errorCard()).toBeInTheDocument();
      expect(queryPreviewCard()).not.toBeInTheDocument();
    });
  });

  describe("a new frame", () => {
    function refuseDenied(mocks: ActionMocks): void {
      mocks.copyToClipboard.mockImplementation(
        async (image: Promise<Blob>): Promise<void> => {
          await image;

          throw new ReplayScreenshotClipboardError("denied", "refused");
        },
      );
    }

    it("takes the error card away when the frame changes", async () => {
      const mocks: ActionMocks = makeMocks();

      refuseDenied(mocks);

      const view: ReturnType<typeof render> = renderActions(mocks, {
        frameKey: "1:41200",
      });

      await clickAndSettle(copyButton());
      expect(errorCard()).toBeInTheDocument();

      rerenderActions(view, mocks, { frameKey: "1:52000" });

      expect(queryErrorCard()).not.toBeInTheDocument();
      expect(copyButton()).toBeEnabled();
    });

    it("keeps the error card while the frame stays the same", async () => {
      const mocks: ActionMocks = makeMocks();

      refuseDenied(mocks);

      const view: ReturnType<typeof render> = renderActions(mocks, {
        frameKey: "1:41200",
      });

      await clickAndSettle(copyButton());

      rerenderActions(view, mocks, { frameKey: "1:41200", fit: "width" });

      expect(errorCard()).toHaveTextContent("Clipboard access was blocked");
    });

    it("forgets the PNG it drew, so Download instead draws the new frame", async () => {
      const first: ReplayScreenshot = makeScreenshot();
      const second: ReplayScreenshot = makeScreenshot({
        fileName: "session-replay-3f9a2c1b-0m52.0s.png",
      });
      const mocks: ActionMocks = makeMocks();

      mocks.onCapture
        .mockImplementationOnce((): Promise<ReplayScreenshot> => {
          return Promise.resolve(first);
        })
        .mockImplementationOnce((): Promise<ReplayScreenshot> => {
          return Promise.resolve(second);
        });
      refuseDenied(mocks);

      const view: ReturnType<typeof render> = renderActions(mocks, {
        frameKey: "1:41200",
      });

      await clickAndSettle(copyButton());

      /* A seek while paused; the clipboard is now known to be unusable. */
      rerenderActions(view, mocks, { frameKey: "1:52000" });
      rerenderActions(view, mocks, {
        frameKey: "1:52000",
        clipboardSupport: "unsupported",
      });
      fireEvent.click(copyButton());

      expect(errorCard()).toHaveAttribute("data-recovery", "download");

      await clickAndSettle(recoverButton());

      expect(mocks.onCapture).toHaveBeenCalledTimes(2);
      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(mocks.download.mock.calls[0]?.[0]).toBe(second);
      expect(previewCard()).toHaveTextContent(
        "session-replay-3f9a2c1b-0m52.0s.png",
      );
    });

    it("keeps the PNG it drew for Download instead while the frame stays the same", async () => {
      const first: ReplayScreenshot = makeScreenshot();
      const mocks: ActionMocks = makeMocks(first);

      refuseDenied(mocks);

      const view: ReturnType<typeof render> = renderActions(mocks, {
        frameKey: "1:41200",
      });

      await clickAndSettle(copyButton());

      rerenderActions(view, mocks, {
        frameKey: "1:41200",
        clipboardSupport: "unsupported",
      });
      fireEvent.click(copyButton());
      fireEvent.click(recoverButton());

      expect(mocks.onCapture).toHaveBeenCalledTimes(1);
      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(mocks.download.mock.calls[0]?.[0]).toBe(first);
    });

    it("forgets the PNG when a new capture starts", async () => {
      const first: ReplayScreenshot = makeScreenshot();
      const mocks: ActionMocks = makeMocks(first);
      const failedCopy: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();

      refuseDenied(mocks);
      renderActions(mocks);

      await clickAndSettle(copyButton());
      expect(errorCard()).toBeInTheDocument();

      /*
       * A second copy whose clipboard fails before its frame is drawn: the
       * first PNG must not stand in for a frame that was never captured.
       */
      mocks.onCapture.mockImplementationOnce((): Promise<ReplayScreenshot> => {
        return failedCopy.promise;
      });
      mocks.copyToClipboard.mockImplementationOnce(
        (image: Promise<Blob>): Promise<void> => {
          image.catch(ignoreRejection);

          return Promise.reject(
            new ReplayScreenshotClipboardError("failed", "no clipboard"),
          );
        },
      );

      await clickAndSettle(copyButton());
      expect(errorCard()).toHaveTextContent("Couldn't copy the image");

      await clickAndSettle(recoverButton());

      expect(mocks.onCapture).toHaveBeenCalledTimes(3);
      expect(mocks.download).toHaveBeenCalledTimes(1);
    });

    it("never offers a PNG of the previous frame whose capture lands after a seek", async () => {
      const frameOne: ReplayScreenshot = makeScreenshot({
        fileName: "session-replay-3f9a2c1b-0m41.2s.png",
      });
      const frameTwo: ReplayScreenshot = makeScreenshot({
        fileName: "session-replay-3f9a2c1b-0m52.0s.png",
      });
      /* Any capture drawn from here on is of the second frame. */
      const mocks: ActionMocks = makeMocks(frameTwo);
      const captureOne: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();
      const captureTwo: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();

      mocks.onCapture
        .mockImplementationOnce((): Promise<ReplayScreenshot> => {
          return captureOne.promise;
        })
        .mockImplementationOnce((): Promise<ReplayScreenshot> => {
          return captureTwo.promise;
        });
      /*
       * A clipboard that refuses at once - a browser whose ClipboardItem
       * throws on a promise - so each copy fails while its frame is still
       * being drawn, and the buttons are free again.
       */
      mocks.copyToClipboard.mockImplementation(
        (image: Promise<Blob>): Promise<void> => {
          image.catch(ignoreRejection);

          return Promise.reject(
            new ReplayScreenshotClipboardError("failed", "no clipboard"),
          );
        },
      );

      const view: ReturnType<typeof render> = renderActions(mocks, {
        frameKey: "1:41200",
      });

      await clickAndSettle(copyButton());
      expect(errorCard()).toHaveTextContent("Couldn't copy the image");

      /* A seek while paused, then a copy of the new frame. */
      rerenderActions(view, mocks, { frameKey: "1:52000" });
      await clickAndSettle(copyButton());
      expect(errorCard()).toHaveTextContent("Couldn't copy the image");

      /* The first frame's capture finally lands. */
      await settle((): void => {
        captureOne.resolve(frameOne);
      });

      await clickAndSettle(recoverButton());
      await settle((): void => {
        captureTwo.resolve(frameTwo);
      });

      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(mocks.download).not.toHaveBeenCalledWith(frameOne);
      expect(
        (mocks.download.mock.calls[0]?.[0] as ReplayScreenshot | undefined)
          ?.fileName,
      ).toBe("session-replay-3f9a2c1b-0m52.0s.png");
    });
  });

  describe("unmounting", () => {
    it("still saves a download that lands after the dock unmounted, and touches nothing else", async () => {
      const shot: ReplayScreenshot = makeScreenshot();
      const mocks: ActionMocks = makeMocks(shot);
      const capture: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();

      mocks.onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
        return capture.promise;
      });

      const view: ReturnType<typeof render> = renderActions(mocks);

      fireEvent.click(downloadButton());
      view.unmount();

      /* Watched from here: only what lands after the unmount counts. */
      const consoleError: ConsoleSpy = jest.spyOn(
        console,
        "error",
      ) as unknown as ConsoleSpy;

      /* Outside act on purpose: a state update would warn. */
      capture.resolve(shot);
      await flushMicrotasks();

      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(mocks.download.mock.calls[0]?.[0]).toBe(shot);
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
      expect(view.container).toBeEmptyDOMElement();
      expect(consoleError.mock.calls).toHaveLength(0);
    });

    it("ignores a copy that lands after the dock unmounted", async () => {
      const shot: ReplayScreenshot = makeScreenshot();
      const mocks: ActionMocks = makeMocks(shot);
      const capture: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();

      mocks.onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
        return capture.promise;
      });

      const view: ReturnType<typeof render> = renderActions(mocks);

      fireEvent.click(copyButton());

      const image: Promise<Blob> = mocks.copyToClipboard.mock
        .calls[0]?.[0] as Promise<Blob>;

      view.unmount();

      /* Watched from here: only what lands after the unmount counts. */
      const consoleError: ConsoleSpy = jest.spyOn(
        console,
        "error",
      ) as unknown as ConsoleSpy;

      capture.resolve(shot);
      await flushMicrotasks();

      /* The clipboard write it started still gets its PNG. */
      await expect(image).resolves.toBe(shot.blob);
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
      expect(consoleError.mock.calls).toHaveLength(0);
    });

    it("ignores a failure that lands after the dock unmounted", async () => {
      const mocks: ActionMocks = makeMocks();
      const capture: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();

      mocks.onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
        return capture.promise;
      });

      const view: ReturnType<typeof render> = renderActions(mocks);

      fireEvent.click(copyButton());
      view.unmount();

      /* Watched from here: only what lands after the unmount counts. */
      const consoleError: ConsoleSpy = jest.spyOn(
        console,
        "error",
      ) as unknown as ConsoleSpy;

      capture.reject(new ReplayFrameCaptureError("render-failed", "capture"));
      await flushMicrotasks();

      expect(view.container).toBeEmptyDOMElement();
      expect(jest.getTimerCount()).toBe(0);
      expect(consoleError.mock.calls).toHaveLength(0);
    });

    it("lets a capture that lands after a remount leave the new dock alone", async () => {
      const mocks: ActionMocks = makeMocks();
      const capture: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();

      mocks.onCapture.mockImplementationOnce((): Promise<ReplayScreenshot> => {
        return capture.promise;
      });

      const first: ReturnType<typeof render> = renderActions(mocks);

      fireEvent.click(downloadButton());
      first.unmount();

      /* Paused again: a fresh dock. */
      renderActions(mocks);

      await settle((): void => {
        capture.resolve(makeScreenshot());
      });

      expect(queryPreviewCard()).not.toBeInTheDocument();
      expect(downloadButton()).toHaveAttribute("data-state", "idle");
      expect(downloadButton()).toBeEnabled();
      expect(statusText()).toBe("");
    });

    it("revokes the thumbnail and clears its timers when it unmounts", async () => {
      const view: ReturnType<typeof render> = renderActions(makeMocks());

      await clickAndSettle(copyButton());
      expect(previewCard()).toBeInTheDocument();
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      view.unmount();

      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:replay/1");
      expect(jest.getTimerCount()).toBe(0);
    });

    it("cancels the entrance frame when it unmounts before it", () => {
      const view: ReturnType<typeof render> = renderActions(makeMocks());

      view.unmount();

      expect(jest.getTimerCount()).toBe(0);
      expect(revokeObjectURL).not.toHaveBeenCalled();
    });
  });

  describe("default wiring", () => {
    it("writes a ClipboardItem holding the pending PNG through the async Clipboard API", async () => {
      const shot: ReplayScreenshot = makeScreenshot();
      const mocks: ActionMocks = makeMocks(shot);
      const capture: Deferred<ReplayScreenshot> =
        makeDeferred<ReplayScreenshot>();
      const write: MockFunction = getJestMockFunction();

      write.mockImplementation(
        async (items: Array<FakeClipboardItem>): Promise<void> => {
          await items[0]?.items["image/png"];
        },
      );
      installClipboard({ write: write, isSecureContext: true });
      mocks.onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
        return capture.promise;
      });
      renderActions(mocks, {
        clipboardSupport: undefined,
        copyToClipboard: undefined,
      });

      expect(copyButton()).toHaveAttribute("title", COPY_TITLE_SUPPORTED);

      fireEvent.click(copyButton());

      /* Inside the click, with the capture still running. */
      expect(write).toHaveBeenCalledTimes(1);

      const items: Array<FakeClipboardItem> = write.mock
        .calls[0]?.[0] as Array<FakeClipboardItem>;

      expect(items).toHaveLength(1);
      expect(items[0]).toBeInstanceOf(FakeClipboardItem);
      expect(Object.keys(items[0]?.items ?? {})).toEqual(["image/png"]);

      const png: unknown = items[0]?.items["image/png"];

      expect(png).toBeInstanceOf(Promise);

      await settle((): void => {
        capture.resolve(shot);
      });

      await expect(png as Promise<Blob>).resolves.toBe(shot.blob);
      expect(previewCard()).toHaveAttribute("data-action", "copy");
      expect(statusText()).toBe("Screenshot copied to the clipboard.");
    });

    it("names a clipboard the browser blocked and saves the drawn PNG instead", async () => {
      const shot: ReplayScreenshot = makeScreenshot();
      const mocks: ActionMocks = makeMocks(shot);
      const write: MockFunction = getJestMockFunction();

      write.mockImplementation(
        async (items: Array<FakeClipboardItem>): Promise<void> => {
          await items[0]?.items["image/png"];

          throw namedError("NotAllowedError", "Write permission denied.");
        },
      );
      installClipboard({ write: write, isSecureContext: true });
      renderActions(mocks, {
        clipboardSupport: undefined,
        copyToClipboard: undefined,
      });

      await clickAndSettle(copyButton());

      expect(errorCard()).toHaveTextContent("Clipboard access was blocked");
      expect(errorCard()).toHaveAttribute("data-recovery", "download");

      fireEvent.click(recoverButton());

      expect(mocks.onCapture).toHaveBeenCalledTimes(1);
      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(mocks.download.mock.calls[0]?.[0]).toBe(shot);
    });

    it("reports the capture's failure rather than the clipboard's", async () => {
      const mocks: ActionMocks = makeMocks();
      const write: MockFunction = getJestMockFunction();

      write.mockImplementation(
        async (items: Array<FakeClipboardItem>): Promise<void> => {
          try {
            await items[0]?.items["image/png"];
          } catch {
            throw namedError("DataError", "The image promise rejected.");
          }
        },
      );
      installClipboard({ write: write, isSecureContext: true });
      mocks.onCapture.mockImplementation((): Promise<ReplayScreenshot> => {
        return Promise.reject(
          new ReplayFrameCaptureError("render-failed", "capture"),
        );
      });
      renderActions(mocks, {
        clipboardSupport: undefined,
        copyToClipboard: undefined,
      });

      await clickAndSettle(copyButton());

      expect(errorCard()).toHaveTextContent("Couldn't capture this frame");
      expect(errorCard()).toHaveAttribute("data-recovery", "retry");
    });

    it("says HTTPS is needed on an insecure page, without touching the clipboard", () => {
      const mocks: ActionMocks = makeMocks();
      const write: MockFunction = getJestMockFunction();

      installClipboard({ write: write, isSecureContext: false });
      renderActions(mocks, {
        clipboardSupport: undefined,
        copyToClipboard: undefined,
      });

      fireEvent.click(copyButton());

      expect(errorCard()).toHaveTextContent("Copying images needs HTTPS");
      expect(write).not.toHaveBeenCalled();
      expect(mocks.onCapture).not.toHaveBeenCalled();
    });

    it("saves the PNG through a hidden download link and releases its URL later", async () => {
      const shot: ReplayScreenshot = makeScreenshot();
      const mocks: ActionMocks = makeMocks(shot);
      const clicked: Array<{
        href: string | null;
        download: string;
        rel: string;
        display: string;
        isConnected: boolean;
      }> = [];

      jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation((): void => {
          const anchor: HTMLAnchorElement | null =
            document.querySelector<HTMLAnchorElement>("a[download]");

          if (anchor) {
            clicked.push({
              href: anchor.getAttribute("href"),
              download: anchor.download,
              rel: anchor.rel,
              display: anchor.style.display,
              isConnected: anchor.isConnected,
            });
          }
        });
      renderActions(mocks, { download: undefined });

      await clickAndSettle(downloadButton());

      expect(clicked).toEqual([
        {
          href: "blob:replay/1",
          download: FILE_NAME,
          rel: "noopener",
          display: "none",
          isConnected: true,
        },
      ]);
      expect(document.querySelector("a[download]")).toBeNull();
      expect(createObjectURL).toHaveBeenCalledTimes(2);
      expect(createObjectURL).toHaveBeenNthCalledWith(1, shot.blob);
      expect(screen.getByTestId("replay-screenshot-thumbnail")).toHaveAttribute(
        "src",
        "blob:replay/2",
      );
      expect(previewCard()).toHaveAttribute("data-action", "download");

      advance(REPLAY_SCREENSHOT_URL_TTL_MS - 1);
      expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:replay/1");

      advance(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:replay/1");
    });
  });
});
