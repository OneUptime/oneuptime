import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

/*
 * Every lookup marked, as a reader of another language would see each
 * string come back from its locale: a string drawn without a lookup reads
 * unmarked, one looked up twice reads "⟦⟦...⟧⟧".
 */
jest.mock("../../../UI/Utils/Translation", () => {
  const mark: (value: string | undefined) => string | undefined = (
    value: string | undefined,
  ): string | undefined => {
    return value === undefined || value === "" ? value : `⟦${value}⟧`;
  };

  return {
    __esModule: true,
    default: (): {
      translateString: (value: string | undefined) => string | undefined;
      translateValue: (value: unknown) => unknown;
      language: string;
    } => {
      return {
        translateString: mark,
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? mark(value) : value;
        },
        language: "de",
      };
    },
  };
});

import ReplayScreenshotActions, {
  REPLAY_SCREENSHOT_COMPACT_STAGE_PX,
  ReplayScreenshotActionsProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScreenshotActions";
import { ReplayFrameCaptureError } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayFrameCapture";
import { ReplayScreenshot } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScreenshot";

/*
 * The paused stage's screenshot dock in the reader's language (#6369): its
 * group and buttons, their tooltips, the failure cards and their ways out,
 * the success card and the phone's pill, and what the status region
 * announces were English in every language. The file name and the PNG's
 * size are values: they read as they are.
 */

const FILE_NAME: string = "session-replay-3f9a2c1b-0m41.2s.png";

function makeScreenshot(): ReplayScreenshot {
  return {
    blob: new Blob(["png-bytes"], { type: "image/png" }),
    fileName: FILE_NAME,
    width: 1440,
    height: 900,
  };
}

function makeProps(
  overrides?: Partial<ReplayScreenshotActionsProps>,
): ReplayScreenshotActionsProps {
  return {
    onCapture: (): Promise<ReplayScreenshot> => {
      return Promise.resolve(makeScreenshot());
    },
    copyToClipboard: async (image: Promise<Blob>): Promise<void> => {
      await image;
    },
    download: (): void => {
      /* Saved. */
    },
    clipboardSupport: "supported",
    fit: "contain",
    frameKey: "1:41200",
    ...overrides,
  };
}

/* Clicks a button and lets every promise the click started settle. */
async function clickAndSettle(testId: string): Promise<void> {
  fireEvent.click(screen.getByTestId(testId));

  await act(async (): Promise<void> => {
    for (let tick: number = 0; tick < 25; tick++) {
      await Promise.resolve();
    }
  });
}

/* jsdom does no layout: the dock's column is as tall as its stage. */
function setStageHeight(height: number): void {
  Object.defineProperty(
    screen.getByTestId("replay-screenshot"),
    "clientHeight",
    {
      configurable: true,
      get: (): number => {
        return height;
      },
    },
  );
}

beforeEach((): void => {
  jest.useFakeTimers();
  Object.defineProperty(URL, "createObjectURL", {
    value: (): string => {
      return "blob:replay/1";
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: (): void => {
      /* Released. */
    },
    configurable: true,
    writable: true,
  });
});

afterEach((): void => {
  jest.useRealTimers();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("ReplayScreenshotActions in the reader's language", () => {
  it("names the dock and its buttons, and says why copying is unavailable", () => {
    const { rerender } = render(<ReplayScreenshotActions {...makeProps()} />);

    expect(screen.getByTestId("replay-screenshot-actions")).toHaveAttribute(
      "aria-label",
      "⟦Screenshot of this frame⟧",
    );

    const copy: HTMLElement = screen.getByTestId("replay-screenshot-copy");
    const download: HTMLElement = screen.getByTestId(
      "replay-screenshot-download",
    );

    expect(copy).toHaveAttribute(
      "title",
      "⟦Copy this frame to the clipboard as a PNG⟧",
    );
    expect(copy).toHaveAttribute("aria-label", "⟦Copy image⟧");
    expect(copy).toHaveTextContent("⟦Copy image⟧");
    expect(download).toHaveAttribute("title", "⟦Download this frame as a PNG⟧");
    expect(download).toHaveAttribute("aria-label", "⟦Download⟧");
    expect(download).toHaveTextContent("⟦Download⟧");

    rerender(
      <ReplayScreenshotActions
        {...makeProps({ clipboardSupport: "insecure-context" })}
      />,
    );

    expect(screen.getByTestId("replay-screenshot-copy")).toHaveAttribute(
      "title",
      "⟦Copying images needs a secure (https) page - use Download⟧",
    );

    rerender(
      <ReplayScreenshotActions
        {...makeProps({ clipboardSupport: "unsupported" })}
      />,
    );

    expect(screen.getByTestId("replay-screenshot-copy")).toHaveAttribute(
      "title",
      "⟦This browser can't copy images - use Download⟧",
    );
  });

  it("words a clipboard the browser lacks, and offers the download", async () => {
    render(
      <ReplayScreenshotActions
        {...makeProps({ clipboardSupport: "unsupported" })}
      />,
    );

    await clickAndSettle("replay-screenshot-copy");

    const card: HTMLElement = screen.getByTestId("replay-screenshot-error");

    expect(card).toHaveTextContent("⟦This browser can't copy images⟧");
    expect(card).toHaveTextContent(
      "⟦It has no image clipboard. Download the PNG instead - it is the same picture.⟧",
    );
    expect(screen.getByTestId("replay-screenshot-recover")).toHaveTextContent(
      "⟦Download instead⟧",
    );
    expect(
      screen.getByTestId("replay-screenshot-error-dismiss"),
    ).toHaveAttribute("aria-label", "⟦Dismiss⟧");
    expect(card.innerHTML).not.toContain("⟦⟦");
  });

  it("words a frame that could not be drawn, and offers another try", async () => {
    render(
      <ReplayScreenshotActions
        {...makeProps({
          onCapture: (): Promise<ReplayScreenshot> => {
            return Promise.reject(
              new ReplayFrameCaptureError("render-failed", "capture"),
            );
          },
        })}
      />,
    );

    await clickAndSettle("replay-screenshot-download");

    const card: HTMLElement = screen.getByTestId("replay-screenshot-error");

    expect(card).toHaveTextContent("⟦Couldn't capture this frame⟧");
    expect(card).toHaveTextContent(
      "⟦The browser could not draw this recorded page as an image.⟧",
    );
    expect(screen.getByTestId("replay-screenshot-recover")).toHaveTextContent(
      "⟦Try again⟧",
    );
  });

  it("words a saved frame's card and announces the file it was saved as", async () => {
    render(<ReplayScreenshotActions {...makeProps()} />);

    await clickAndSettle("replay-screenshot-download");

    const card: HTMLElement = screen.getByTestId("replay-screenshot-preview");

    expect(card).toHaveTextContent("⟦Screenshot downloaded⟧");
    expect(screen.getByTestId("replay-screenshot-thumbnail")).toHaveAttribute(
      "alt",
      "⟦The captured frame⟧",
    );
    // The file name is the file's own: a value.
    expect(
      screen.getByTestId("replay-screenshot-preview-detail"),
    ).toHaveTextContent(FILE_NAME);
    expect(
      screen.getByTestId("replay-screenshot-preview-dismiss"),
    ).toHaveAttribute("title", "⟦Dismiss⟧");
    expect(screen.getByTestId("replay-screenshot-status")).toHaveTextContent(
      `⟦Screenshot downloaded as ${FILE_NAME}.⟧`,
    );
  });

  it("words a copied frame's card and announces the copy", async () => {
    render(<ReplayScreenshotActions {...makeProps()} />);

    await clickAndSettle("replay-screenshot-copy");

    expect(screen.getByTestId("replay-screenshot-preview")).toHaveTextContent(
      "⟦Copied to clipboard⟧",
    );
    expect(
      screen.getByTestId("replay-screenshot-preview-detail"),
    ).toHaveTextContent("1440 × 900 PNG");
    expect(screen.getByTestId("replay-screenshot-status")).toHaveTextContent(
      "⟦Screenshot copied to the clipboard.⟧",
    );
  });

  it("words the phone's pill and its tooltip as one sentence each", async () => {
    const { unmount } = render(<ReplayScreenshotActions {...makeProps()} />);

    setStageHeight(REPLAY_SCREENSHOT_COMPACT_STAGE_PX - 1);
    await clickAndSettle("replay-screenshot-copy");

    let pill: HTMLElement = screen.getByTestId("replay-screenshot-preview");

    expect(pill).toHaveAttribute("data-compact", "true");
    expect(pill).toHaveTextContent("⟦Copied⟧");
    expect(pill).toHaveAttribute(
      "title",
      "⟦Copied to clipboard: 1440 × 900 PNG⟧",
    );

    unmount();
    render(<ReplayScreenshotActions {...makeProps()} />);
    setStageHeight(REPLAY_SCREENSHOT_COMPACT_STAGE_PX - 1);
    await clickAndSettle("replay-screenshot-download");

    pill = screen.getByTestId("replay-screenshot-preview");

    expect(pill).toHaveTextContent("⟦Saved⟧");
    expect(pill).toHaveAttribute(
      "title",
      `⟦Screenshot downloaded: ${FILE_NAME}⟧`,
    );
  });
});
