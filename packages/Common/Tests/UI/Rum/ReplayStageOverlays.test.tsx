import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
/*
 * The Dashboard has its own copy of react; Common's jest moduleNameMapper
 * pins react and react-dom to this project's single copy for every
 * importer (see the note at the top of ReplayStage.test.tsx).
 */
import * as React from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ReplayStageOverlays, {
  REPLAY_GAP_TOAST_MS,
  REPLAY_IDLE_SKIP_TOAST_MS,
  ReplayStageOverlaysProps,
  findIdleBandAt,
  getReplayStageOverlaysRootClassName,
  getReplayStageOverlaysStageClassName,
  navigationUrlsFromSignals,
  resolveUrlAtPlayhead,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayStageOverlays";
import {
  REPLAY_BUFFERING_GRACE_MS,
  REPLAY_BUFFERING_RETRY_HINT_MS,
  ReplayEngineSnapshot,
  ReplayIdleBand,
  derivePhase,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";
import { ReplaySignal } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import { SessionReplayManifestChunk } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayManifest";

/*
 * Everything drawn over and around the picture. Pinned: the URL bar picks
 * the latest navigation at or before the playhead (falling back to the
 * chunk row's URL and the entry URL); the viewport chip and the
 * Fit / Width / 1:1 toggle; the flex classes that hand the stage the
 * leftover height; overlay precedence error > seeking > buffering > gap > paused;
 * buffering only after the 300ms grace and Retry after 8s; the gap and
 * idle-skip toasts that go away on their own; the ended card's Watch
 * again; the expired EmptyState that carries the retention days; and the
 * sr-only phase word that exists ONLY when no stage is mounted.
 */

const DURATION_MS: number = 252000;

function makeSnapshot(
  overrides?: Partial<ReplayEngineSnapshot>,
): ReplayEngineSnapshot {
  const buffer: ReplayEngineSnapshot["buffer"] = overrides?.buffer ?? "ok";
  const intent: ReplayEngineSnapshot["intent"] = overrides?.intent ?? "paused";

  return {
    phase: derivePhase(buffer, intent),
    intent: intent,
    buffer: buffer,
    currentTimeMs: 41200,
    durationMs: DURATION_MS,
    speed: 1,
    skipInactive: false,
    fedRange: { fromMs: 0, toMs: 60000 },
    loadedChunkIndexes: [0, 1, 2, 3],
    activeTabId: "tab-1",
    recordedSize: { width: 1440, height: 900 },
    bufferingSinceMs: null,
    lastGap: null,
    lastIdleSkip: null,
    error: null,
    pendingSeekMs: null,
    generation: 1,
    notice: null,
    idleBands: [],
    feedAheadMs: 30000,
    earliestPlayableMs: 0,
    ...overrides,
  };
}

function makeChunk(
  chunkIndex: number,
  startMs: number,
  endMs: number,
  url?: string,
): SessionReplayManifestChunk {
  const chunk: SessionReplayManifestChunk = {
    chunkIndex: chunkIndex,
    tabId: "tab-1",
    chunkStartOffsetMs: startMs,
    chunkEndOffsetMs: endMs,
    eventCount: 100,
    hasFullSnapshot: chunkIndex === 0,
    payloadBytes: 1024,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
  };

  if (url !== undefined) {
    chunk.url = url;
  }

  return chunk;
}

function makeNavigation(offsetMs: number, to: string): ReplaySignal {
  return {
    id: `rec:0:${offsetMs}`,
    kind: "navigation",
    source: "recording",
    offsetMs: offsetMs,
    severity: "info",
    title: `Navigated to ${to}`,
    links: {},
    detail: { from: null, to: to, kind: "push", atUnixMs: null },
    alignment: "exact",
  };
}

function makeProps(
  overrides?: Partial<ReplayStageOverlaysProps>,
): ReplayStageOverlaysProps {
  return {
    snapshot: makeSnapshot(),
    signals: [],
    chunks: [makeChunk(0, 0, 15000), makeChunk(1, 15000, 30000)],
    entryUrl: "https://app.acme.com/checkout",
    recordedSize: { width: 1440, height: 900 },
    scale: 0.62,
    fit: "contain",
    onFitChange: jest.fn(),
    canSelectText: true,
    isTextSelectionEnabled: false,
    onTextSelectionChange: jest.fn(),
    onPlayPause: jest.fn(),
    onWatchAgain: jest.fn(),
    onRetry: jest.fn(),
    onStillLoadingRetry: jest.fn(),
    onSkipIdle: jest.fn(),
    getDiagnostic: (): string => {
      return '{"sessionId":"abc"}';
    },
    ...overrides,
  };
}

function renderOverlays(
  overrides?: Partial<ReplayStageOverlaysProps>,
): ReturnType<typeof render> {
  return render(
    <ReplayStageOverlays {...makeProps(overrides)}>
      <div data-testid="fake-stage">stage</div>
    </ReplayStageOverlays>,
  );
}

function setClipboard(
  writeText: ((text: string) => Promise<void>) | null,
): void {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText: writeText } : undefined,
    configurable: true,
  });
}

describe("resolveUrlAtPlayhead", () => {
  const chunks: Array<SessionReplayManifestChunk> = [
    makeChunk(0, 0, 15000, "https://app.acme.com/checkout"),
    makeChunk(1, 15000, 30000, "https://app.acme.com/pay"),
    makeChunk(2, 30000, 45000),
  ];

  it("picks the latest navigation at or before the playhead", () => {
    const navigations: Array<{ offsetMs: number; url: string }> = [
      { offsetMs: 5000, url: "https://app.acme.com/a" },
      { offsetMs: 20000, url: "https://app.acme.com/b" },
      { offsetMs: 40000, url: "https://app.acme.com/c" },
    ];

    expect(
      resolveUrlAtPlayhead({
        navigations,
        chunks: [],
        currentTimeMs: 25000,
        entryUrl: "",
      }),
    ).toBe("https://app.acme.com/b");
    expect(
      resolveUrlAtPlayhead({
        navigations,
        chunks: [],
        currentTimeMs: 40000,
        entryUrl: "",
      }),
    ).toBe("https://app.acme.com/c");
    expect(
      resolveUrlAtPlayhead({
        navigations,
        chunks: [],
        currentTimeMs: 4999,
        entryUrl: "https://e",
      }),
    ).toBe("https://e");
  });

  it("lets a later, still-undecoded chunk's URL beat an earlier navigation", () => {
    expect(
      resolveUrlAtPlayhead({
        navigations: [{ offsetMs: 2000, url: "https://app.acme.com/checkout" }],
        chunks: chunks,
        currentTimeMs: 20000,
        entryUrl: "",
      }),
    ).toBe("https://app.acme.com/pay");
  });

  it("prefers an exact navigation over the chunk URL at the same or a later moment", () => {
    expect(
      resolveUrlAtPlayhead({
        navigations: [{ offsetMs: 15000, url: "https://app.acme.com/exact" }],
        chunks: chunks,
        currentTimeMs: 20000,
        entryUrl: "",
      }),
    ).toBe("https://app.acme.com/exact");
  });

  it("seeds from the entry URL when nothing else is known", () => {
    expect(
      resolveUrlAtPlayhead({
        navigations: [],
        chunks: [makeChunk(0, 0, 15000)],
        currentTimeMs: 3000,
        entryUrl: "https://app.acme.com/checkout",
      }),
    ).toBe("https://app.acme.com/checkout");
  });

  it("navigationUrlsFromSignals keeps only navigation rows with a destination", () => {
    const signals: Array<ReplaySignal> = [
      makeNavigation(1000, "https://app.acme.com/a"),
      { ...makeNavigation(2000, ""), detail: { to: "" } },
      { ...makeNavigation(3000, "x"), kind: "console" },
    ];

    expect(navigationUrlsFromSignals(signals)).toEqual([
      { offsetMs: 1000, url: "https://app.acme.com/a" },
    ]);
  });
});

describe("findIdleBandAt", () => {
  const bands: Array<ReplayIdleBand> = [
    { startMs: 10000, endMs: 52000, kind: "idle", fidelity: "exact" },
    {
      startMs: 100000,
      endMs: 220000,
      kind: "background-tab",
      fidelity: "exact",
    },
  ];

  it("returns the band containing the playhead, half-open at the end", () => {
    expect(findIdleBandAt(bands, 10000)?.startMs).toBe(10000);
    expect(findIdleBandAt(bands, 51999)?.startMs).toBe(10000);
    expect(findIdleBandAt(bands, 52000)).toBeNull();
    expect(findIdleBandAt(bands, 150000)?.kind).toBe("background-tab");
    expect(findIdleBandAt(undefined, 1)).toBeNull();
  });
});

describe("ReplayStageOverlays", () => {
  afterEach(() => {
    jest.useRealTimers();
    setClipboard(null);
  });

  describe("URL bar and viewport chip", () => {
    it("shows the page at the playhead with copy and open, and the viewport with its scale", () => {
      renderOverlays({
        signals: [
          makeNavigation(1000, "https://app.acme.com/checkout"),
          makeNavigation(30000, "https://app.acme.com/checkout/payment"),
          makeNavigation(60000, "https://app.acme.com/thanks"),
        ],
        chunks: [],
      });

      expect(screen.getByTestId("replay-url-text")).toHaveTextContent(
        "https://app.acme.com/checkout/payment",
      );
      expect(screen.getByTestId("replay-url-open")).toHaveAttribute(
        "href",
        "https://app.acme.com/checkout/payment",
      );
      expect(screen.getByTestId("replay-url-open")).toHaveAttribute(
        "rel",
        "noopener noreferrer",
      );
      expect(screen.getByTestId("replay-viewport-chip")).toHaveTextContent(
        "1440x900",
      );
      expect(screen.getByTestId("replay-viewport-chip")).toHaveTextContent(
        "62%",
      );
      expect(screen.getByTestId("fake-stage")).toBeInTheDocument();
    });

    it("offers an accessible text-selection toggle and reports both states", () => {
      const props: ReplayStageOverlaysProps = makeProps();
      const { rerender } = render(
        <ReplayStageOverlays {...props}>
          <div data-testid="fake-stage">stage</div>
        </ReplayStageOverlays>,
      );

      const toggle: HTMLElement = screen.getByTestId("replay-select-text");

      expect(toggle).toHaveTextContent("Select text");
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(toggle).toHaveAttribute(
        "title",
        "Pause the replay and select text to copy",
      );

      fireEvent.click(toggle);
      expect(props.onTextSelectionChange).toHaveBeenCalledWith(true);

      rerender(
        <ReplayStageOverlays {...props} isTextSelectionEnabled={true}>
          <div data-testid="fake-stage">stage</div>
        </ReplayStageOverlays>,
      );

      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(toggle).toHaveAttribute("title", "Exit text selection mode");

      fireEvent.click(toggle);
      expect(props.onTextSelectionChange).toHaveBeenLastCalledWith(false);
    });

    it("keeps the error and retry UI available when there is no replay document", () => {
      renderOverlays({
        canSelectText: false,
        isTextSelectionEnabled: true,
        snapshot: makeSnapshot({
          buffer: "halted",
          error: { message: "Playback stopped", retryable: true },
        }),
      });

      expect(screen.getByTestId("replay-select-text")).toBeDisabled();
      expect(screen.getByTestId("replay-select-text")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByTestId("replay-overlay-error")).toBeInTheDocument();
      expect(screen.getByTestId("replay-overlay-retry")).toBeInTheDocument();
    });

    it("says the URL is not recorded yet rather than showing a blank", () => {
      renderOverlays({ entryUrl: "", chunks: [] });

      expect(screen.getByTestId("replay-url-text")).toHaveTextContent(
        "URL not recorded yet",
      );
      expect(screen.queryByTestId("replay-url-open")).not.toBeInTheDocument();
      expect(screen.queryByTestId("replay-url-copy")).not.toBeInTheDocument();
    });

    it("toggles Fit / Width / 1:1 through onFitChange and hides the percentage at 1:1", () => {
      const props: ReplayStageOverlaysProps = makeProps({ fit: "actual" });

      render(<ReplayStageOverlays {...props} />);

      expect(screen.getByTestId("replay-viewport-chip")).not.toHaveTextContent(
        "%",
      );

      fireEvent.click(screen.getByRole("button", { name: "Fit" }));
      expect(props.onFitChange).toHaveBeenCalledWith("contain");

      fireEvent.click(screen.getByRole("button", { name: "Width" }));
      expect(props.onFitChange).toHaveBeenCalledWith("width");

      fireEvent.click(screen.getByRole("button", { name: "1:1" }));
      expect(props.onFitChange).toHaveBeenCalledWith("actual");
      expect(screen.getByRole("button", { name: "1:1" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    /*
     * Width fit is the third segment, not a mode hidden behind a menu: a
     * tall page in a wide player is the common case the old two-way
     * toggle had no answer for.
     */
    it("offers three fit segments in one labelled group, each saying what it does", () => {
      const { rerender } = render(
        <ReplayStageOverlays {...makeProps({ fit: "width" })} />,
      );

      const group: HTMLElement = screen.getByTestId("replay-fit-toggle");

      expect(group).toHaveAttribute("aria-label", "Stage fit");
      expect(
        Array.from(group.querySelectorAll("button")).map(
          (button: HTMLButtonElement): string | null => {
            return button.textContent;
          },
        ),
      ).toEqual(["Fit", "Width", "1:1"]);

      expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute(
        "title",
        "Fit the whole page in view (z)",
      );
      expect(screen.getByRole("button", { name: "Width" })).toHaveAttribute(
        "title",
        "Fill the width and scroll the page vertically (z)",
      );
      expect(screen.getByRole("button", { name: "1:1" })).toHaveAttribute(
        "title",
        "Actual size (z)",
      );

      expect(screen.getByRole("button", { name: "Width" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      rerender(<ReplayStageOverlays {...makeProps({ fit: "contain" })} />);

      expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Width" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("shows the scale under width fit too, where the picture is scaled as well", () => {
      renderOverlays({ fit: "width", scale: 0.62 });

      expect(screen.getByTestId("replay-viewport-chip")).toHaveTextContent(
        "1440x900",
      );
      expect(screen.getByTestId("replay-viewport-chip")).toHaveTextContent(
        "62%",
      );
    });

    it("keeps the URL bar as compact chrome that never steals the stage's height", () => {
      renderOverlays();

      const bar: HTMLElement = screen.getByTestId("replay-url-bar");

      expect(bar.className).toContain("shrink-0");
      expect(bar.className).toContain("py-1.5");
      expect(bar.className).not.toContain("py-2");
    });

    it("omits the viewport chip when no size is known", () => {
      renderOverlays({ recordedSize: null });

      expect(
        screen.queryByTestId("replay-viewport-chip"),
      ).not.toBeInTheDocument();
    });
  });

  describe("sizing", () => {
    /*
     * The stage box can only take the leftover height of the player card
     * if every box between the two passes it down. Below xl the player is
     * in document flow and the stage sizes itself from the recorded
     * aspect, so the flex rules are xl-prefixed; theater ("fill") has a
     * definite height at every width.
     */
    it("hands the stage the leftover height from xl up by default", () => {
      renderOverlays();

      const overlay: HTMLElement = screen.getByTestId("replay-overlay");

      expect(overlay).toHaveAttribute("data-replay-sizing", "responsive");
      expect(overlay.className).toBe(
        getReplayStageOverlaysRootClassName("responsive"),
      );
      expect(overlay.className).toContain("xl:flex-1");
      expect(overlay.className).toContain("xl:min-h-0");
      expect(overlay.className).toContain("flex-col");

      const container: HTMLElement = screen.getByTestId(
        "replay-stage-container",
      );

      expect(container.className).toBe(
        getReplayStageOverlaysStageClassName("responsive"),
      );
      /* Overlays are positioned against this wrapper, so it stays relative. */
      expect(container.className).toContain("relative");
      expect(container.className).toContain("xl:flex-1");
    });

    it("fills the height at every width in theater", () => {
      renderOverlays({ sizing: "fill" });

      const overlay: HTMLElement = screen.getByTestId("replay-overlay");

      expect(overlay).toHaveAttribute("data-replay-sizing", "fill");
      expect(overlay.className).toBe(
        getReplayStageOverlaysRootClassName("fill"),
      );
      expect(overlay.className).toContain("h-full");
      expect(overlay.className).toContain("flex-1");
      expect(overlay.className).not.toContain("xl:");

      const container: HTMLElement = screen.getByTestId(
        "replay-stage-container",
      );

      expect(container.className).toBe(
        getReplayStageOverlaysStageClassName("fill"),
      );
      expect(container.className).toContain("min-h-0");
      expect(container.className).toContain("flex-1");
    });

    it("gives the no-footage mode the same flex classes so it fills the card too", () => {
      render(
        <ReplayStageOverlays
          {...makeProps({ absence: { kind: "none-stored" }, sizing: "fill" })}
        />,
      );

      const overlay: HTMLElement = screen.getByTestId("replay-overlay");

      expect(overlay).toHaveAttribute("data-replay-overlay", "absent");
      expect(overlay).toHaveAttribute("data-replay-sizing", "fill");
      expect(overlay.className).toContain(
        getReplayStageOverlaysRootClassName("fill"),
      );
      expect(overlay.className).toContain("bg-gray-50");
      expect(overlay.className).toContain("overflow-y-auto");
      /* Auto margins centre it without putting its top out of reach. */
      expect(screen.getByTestId("replay-footage-absent").className).toContain(
        "my-auto",
      );
    });

    it("keeps the cards inside a short stage instead of spilling out of it", () => {
      renderOverlays({
        snapshot: makeSnapshot({
          buffer: "halted",
          error: { message: "Boom", retryable: true },
        }),
      });

      const centre: HTMLElement = screen.getByTestId("replay-overlay-centre");

      expect(centre.className).toContain("absolute");
      expect(centre.className).toContain("overflow-auto");
      expect(centre.className).toContain("p-3");
      expect(screen.getByTestId("replay-overlay-error").className).toContain(
        "max-h-full",
      );
    });
  });

  describe("phase overlays", () => {
    it("shows the error card with Retry (retryable only) above everything else", () => {
      const props: ReplayStageOverlaysProps = makeProps({
        snapshot: makeSnapshot({
          buffer: "halted",
          intent: "playing",
          error: {
            message: "Footage from 0:41 did not arrive.",
            retryable: true,
          },
          lastGap: { fromIndex: 2, toIndex: 4, missingMs: 18000 },
          pendingSeekMs: 72000,
        }),
      });

      render(<ReplayStageOverlays {...props} />);

      const error: HTMLElement = screen.getByTestId("replay-overlay-error");

      expect(error).toHaveTextContent("Footage from 0:41 did not arrive.");
      expect(error).toHaveAttribute("role", "alert");
      expect(
        screen.queryByTestId("replay-overlay-gap"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("replay-overlay-seeking"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("replay-overlay-retry"));
      expect(props.onRetry).toHaveBeenCalledTimes(1);
    });

    it("hides Retry when the error is not retryable", () => {
      renderOverlays({
        snapshot: makeSnapshot({
          buffer: "halted",
          error: {
            message: "No footage is stored for this tab.",
            retryable: false,
          },
        }),
      });

      expect(screen.getByTestId("replay-overlay-error")).toBeInTheDocument();
      expect(
        screen.queryByTestId("replay-overlay-retry"),
      ).not.toBeInTheDocument();
    });

    it("copies the diagnostic, or shows it when the clipboard is unavailable", async () => {
      const writeText: MockFunction = getJestMockFunction();

      writeText.mockResolvedValue(undefined);

      setClipboard(writeText);

      const { unmount } = renderOverlays({
        snapshot: makeSnapshot({
          buffer: "halted",
          error: { message: "Boom", retryable: true },
        }),
      });

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("replay-overlay-copy-diagnostic"));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith('{"sessionId":"abc"}');
      expect(
        screen.getByTestId("replay-overlay-copy-diagnostic"),
      ).toHaveTextContent("Diagnostic copied");

      unmount();
      setClipboard(null);

      renderOverlays({
        snapshot: makeSnapshot({
          buffer: "halted",
          error: { message: "Boom", retryable: true },
        }),
      });

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("replay-overlay-copy-diagnostic"));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        (
          screen.getByTestId(
            "replay-overlay-diagnostic-text",
          ) as HTMLTextAreaElement
        ).value,
      ).toBe('{"sessionId":"abc"}');
    });

    it("shows 'Seeking to m:ss' from the pending target while building paused", () => {
      renderOverlays({
        snapshot: makeSnapshot({
          buffer: "building",
          intent: "paused",
          pendingSeekMs: 72000,
          lastGap: { fromIndex: 2, toIndex: 4, missingMs: 18000 },
        }),
      });

      expect(screen.getByTestId("replay-overlay-seeking")).toHaveTextContent(
        "Seeking to 1:12",
      );
      expect(
        screen.queryByTestId("replay-overlay-gap"),
      ).not.toBeInTheDocument();
    });

    it("shows the buffering pill only after the 300ms grace, and Retry after 8s", () => {
      jest.useFakeTimers();

      const props: ReplayStageOverlaysProps = makeProps({
        snapshot: makeSnapshot({ buffer: "building", intent: "playing" }),
      });

      render(<ReplayStageOverlays {...props} />);

      expect(
        screen.queryByTestId("replay-overlay-buffering"),
      ).not.toBeInTheDocument();

      act((): void => {
        jest.advanceTimersByTime(REPLAY_BUFFERING_GRACE_MS);
      });

      expect(screen.getByTestId("replay-overlay-buffering")).toHaveAttribute(
        "data-stage",
        "pill",
      );
      expect(screen.getByTestId("replay-overlay-buffering")).toHaveTextContent(
        "Buffering",
      );

      act((): void => {
        jest.advanceTimersByTime(
          REPLAY_BUFFERING_RETRY_HINT_MS - REPLAY_BUFFERING_GRACE_MS,
        );
      });

      expect(screen.getByTestId("replay-overlay-buffering")).toHaveAttribute(
        "data-stage",
        "retry",
      );
      expect(screen.getByTestId("replay-overlay-buffering")).toHaveTextContent(
        "Still loading",
      );

      fireEvent.click(screen.getByTestId("replay-overlay-still-loading-retry"));
      expect(props.onStillLoadingRetry).toHaveBeenCalledTimes(1);
    });

    it("words a stall as waiting for footage, and drops the pill the moment playback resumes", () => {
      jest.useFakeTimers();

      const { rerender } = renderOverlays({
        snapshot: makeSnapshot({ buffer: "stalled", intent: "playing" }),
      });

      act((): void => {
        jest.advanceTimersByTime(REPLAY_BUFFERING_GRACE_MS);
      });

      expect(screen.getByTestId("replay-overlay-buffering")).toHaveTextContent(
        "Waiting for the next footage",
      );

      rerender(
        <ReplayStageOverlays
          {...makeProps({
            snapshot: makeSnapshot({ buffer: "ok", intent: "playing" }),
          })}
        >
          <div data-testid="fake-stage">stage</div>
        </ReplayStageOverlays>,
      );

      expect(
        screen.queryByTestId("replay-overlay-buffering"),
      ).not.toBeInTheDocument();
    });

    it("shows a 2s gap interstitial naming the missing stretch, then removes it", () => {
      jest.useFakeTimers();

      const { rerender } = renderOverlays({
        snapshot: makeSnapshot({ buffer: "ok", intent: "playing" }),
      });

      expect(
        screen.queryByTestId("replay-overlay-gap"),
      ).not.toBeInTheDocument();

      rerender(
        <ReplayStageOverlays
          {...makeProps({
            snapshot: makeSnapshot({
              buffer: "ok",
              intent: "playing",
              lastGap: { fromIndex: 2, toIndex: 4, missingMs: 18000 },
            }),
          })}
        >
          <div data-testid="fake-stage">stage</div>
        </ReplayStageOverlays>,
      );

      const gap: HTMLElement = screen.getByTestId("replay-overlay-gap");

      expect(gap).toHaveTextContent("Skipped 18s");
      expect(gap).toHaveTextContent(
        "the recorder never delivered this stretch",
      );
      expect(gap).toHaveAttribute("role", "status");
      /* No ticking pill while playing normally with a gap toast up. */
      expect(
        screen.queryByTestId("replay-overlay-paused"),
      ).not.toBeInTheDocument();

      act((): void => {
        jest.advanceTimersByTime(REPLAY_GAP_TOAST_MS);
      });

      expect(
        screen.queryByTestId("replay-overlay-gap"),
      ).not.toBeInTheDocument();
    });

    it("shows a 1.5s toast for an idle skip", () => {
      jest.useFakeTimers();

      renderOverlays({
        snapshot: makeSnapshot({
          buffer: "ok",
          intent: "playing",
          lastIdleSkip: {
            startMs: 10000,
            endMs: 82000,
            kind: "idle",
            fidelity: "exact",
          },
        }),
      });

      expect(screen.getByTestId("replay-overlay-idle-skip")).toHaveTextContent(
        "Skipped 1m 12s idle",
      );

      act((): void => {
        jest.advanceTimersByTime(REPLAY_IDLE_SKIP_TOAST_MS);
      });

      expect(
        screen.queryByTestId("replay-overlay-idle-skip"),
      ).not.toBeInTheDocument();
    });

    it("shows the ended card with Watch again and the continue-in-tab action", () => {
      const props: ReplayStageOverlaysProps = makeProps({
        snapshot: makeSnapshot({ buffer: "ended", currentTimeMs: DURATION_MS }),
        continueInTab: {
          tabId: "tab-2",
          label: "Tab 2",
          durationMs: 30000,
          openedAtMs: 134000,
          hasFootage: true,
          isActive: false,
        },
        onSwitchTab: jest.fn(),
      });

      render(<ReplayStageOverlays {...props} />);

      const ended: HTMLElement = screen.getByTestId("replay-overlay-ended");

      expect(ended).toHaveTextContent("Replay ended");
      expect(ended).toHaveTextContent("4m 12s of footage played out");

      fireEvent.click(screen.getByTestId("replay-watch-again"));
      expect(props.onWatchAgain).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("replay-ended-continue-in-tab"));
      expect(props.onSwitchTab).toHaveBeenCalledWith("tab-2");
    });

    /*
     * Continuing is "keep watching", which is a different request to the
     * engine from "take me to that tab": the shell resumes playback with
     * the switch rather than landing the next page of the visit paused
     * (github.com/OneUptime/oneuptime/issues/3865). So the chip prefers
     * its own handler when it is given one.
     */
    it("prefers the continue handler over the plain tab switch", () => {
      const props: ReplayStageOverlaysProps = makeProps({
        snapshot: makeSnapshot({ buffer: "ended", currentTimeMs: DURATION_MS }),
        continueInTab: {
          tabId: "tab-2",
          label: "Tab 2",
          durationMs: 30000,
          openedAtMs: 134000,
          hasFootage: true,
          isActive: false,
        },
        onSwitchTab: jest.fn(),
        onContinueInTab: jest.fn(),
      });

      render(<ReplayStageOverlays {...props} />);

      fireEvent.click(screen.getByTestId("replay-ended-continue-in-tab"));

      expect(props.onContinueInTab).toHaveBeenCalledWith("tab-2");
      expect(props.onSwitchTab).not.toHaveBeenCalled();
    });

    /* A caller that only knows about the continue handler still gets the chip. */
    it("shows the chip when only the continue handler is given", () => {
      const props: ReplayStageOverlaysProps = makeProps({
        snapshot: makeSnapshot({ buffer: "ended", currentTimeMs: DURATION_MS }),
        continueInTab: {
          tabId: "tab-3",
          label: "Tab 3",
          durationMs: 30000,
          openedAtMs: 200000,
          hasFootage: true,
          isActive: false,
        },
        onContinueInTab: jest.fn(),
      });

      render(<ReplayStageOverlays {...props} />);

      const chip: HTMLElement = screen.getByTestId(
        "replay-ended-continue-in-tab",
      );

      expect(chip).toHaveTextContent("Continue in Tab 3");

      fireEvent.click(chip);
      expect(props.onContinueInTab).toHaveBeenCalledWith("tab-3");
    });

    /* No handler at all: no chip, rather than a dead button. */
    it("draws no chip without a handler for it", () => {
      render(
        <ReplayStageOverlays
          {...makeProps({
            snapshot: makeSnapshot({
              buffer: "ended",
              currentTimeMs: DURATION_MS,
            }),
            continueInTab: {
              tabId: "tab-2",
              label: "Tab 2",
              durationMs: 30000,
              openedAtMs: 134000,
              hasFootage: true,
              isActive: false,
            },
          })}
        />,
      );

      expect(
        screen.queryByTestId("replay-ended-continue-in-tab"),
      ).not.toBeInTheDocument();
    });

    it("offers the user's next session from the ended card", () => {
      const props: ReplayStageOverlaysProps = makeProps({
        snapshot: makeSnapshot({ buffer: "ended", currentTimeMs: DURATION_MS }),
        nextUserSession: {
          sessionId: "session-9",
          description: "2 hours later - /checkout - 3m 20s",
        },
        onOpenNextUserSession: jest.fn(),
      });

      render(<ReplayStageOverlays {...props} />);

      const next: HTMLElement = screen.getByTestId("replay-ended-next-session");

      expect(next).toHaveTextContent("Next session by this user");
      expect(next).toHaveAttribute(
        "title",
        "2 hours later - /checkout - 3m 20s",
      );

      fireEvent.click(next);
      expect(props.onOpenNextUserSession).toHaveBeenCalledWith("session-9");
    });

    it("offers no next session when there is none, no handler, or the session is live", () => {
      const { rerender } = render(
        <ReplayStageOverlays
          {...makeProps({
            snapshot: makeSnapshot({
              buffer: "ended",
              currentTimeMs: DURATION_MS,
            }),
          })}
        />,
      );

      expect(
        screen.queryByTestId("replay-ended-next-session"),
      ).not.toBeInTheDocument();

      /* A session id with nothing to do with it is not an offer. */
      rerender(
        <ReplayStageOverlays
          {...makeProps({
            snapshot: makeSnapshot({
              buffer: "ended",
              currentTimeMs: DURATION_MS,
            }),
            nextUserSession: { sessionId: "session-9", description: "later" },
          })}
        />,
      );

      expect(
        screen.queryByTestId("replay-ended-next-session"),
      ).not.toBeInTheDocument();

      /* Live: the recording has not ended, so there is no ended card. */
      rerender(
        <ReplayStageOverlays
          {...makeProps({
            snapshot: makeSnapshot({
              buffer: "ended",
              currentTimeMs: DURATION_MS,
            }),
            isLive: true,
            nextUserSession: { sessionId: "session-9", description: "later" },
            onOpenNextUserSession: jest.fn(),
          })}
        />,
      );

      expect(
        screen.queryByTestId("replay-ended-next-session"),
      ).not.toBeInTheDocument();
    });

    /*
     * ux-07: a live session that catches up has not ended. The stage used
     * to show "Replay ended - Watch again" beside a Live pill and a
     * "Caught up" chip, and Watch again rewound a recording the viewer was
     * following. The honest state is the wait, with its cadence.
     */
    it("a live session that catches up says it is waiting, and offers no rewind", () => {
      const props: ReplayStageOverlaysProps = makeProps({
        snapshot: makeSnapshot({ buffer: "ended", currentTimeMs: DURATION_MS }),
        isLive: true,
      });

      render(<ReplayStageOverlays {...props} />);

      const caughtUp: HTMLElement = screen.getByTestId(
        "replay-overlay-live-caught-up",
      );

      expect(caughtUp).toHaveTextContent("Caught up with the live recording");
      expect(caughtUp).toHaveTextContent("waiting for the next chunk");
      expect(caughtUp).toHaveTextContent("every 30 seconds");
      expect(
        screen.queryByTestId("replay-overlay-ended"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("replay-watch-again"),
      ).not.toBeInTheDocument();
    });

    it("says it exactly once - the chip strip no longer repeats it", () => {
      render(
        <ReplayStageOverlays
          {...makeProps({
            snapshot: makeSnapshot({
              buffer: "ended",
              currentTimeMs: DURATION_MS,
            }),
            isLive: true,
          })}
        />,
      );

      expect(
        screen.getAllByText(/Caught up with the live recording/),
      ).toHaveLength(1);
    });

    it("a finalized recording that ends still offers Watch again", () => {
      const props: ReplayStageOverlaysProps = makeProps({
        snapshot: makeSnapshot({ buffer: "ended", currentTimeMs: DURATION_MS }),
        isLive: false,
      });

      render(<ReplayStageOverlays {...props} />);

      expect(screen.getByTestId("replay-overlay-ended")).toHaveTextContent(
        "Replay ended",
      );
      expect(
        screen.queryByTestId("replay-overlay-live-caught-up"),
      ).not.toBeInTheDocument();
    });

    it("shows a play affordance while paused and nothing while playing", () => {
      const props: ReplayStageOverlaysProps = makeProps({
        snapshot: makeSnapshot({ buffer: "ok", intent: "paused" }),
      });

      const { rerender } = render(<ReplayStageOverlays {...props} />);

      fireEvent.click(screen.getByTestId("replay-overlay-paused"));
      expect(props.onPlayPause).toHaveBeenCalledTimes(1);

      rerender(
        <ReplayStageOverlays
          {...makeProps({
            snapshot: makeSnapshot({ buffer: "ok", intent: "playing" }),
          })}
        />,
      );

      expect(
        screen.queryByTestId("replay-overlay-paused"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("replay-overlay")).toHaveAttribute(
        "data-replay-overlay",
        "playing",
      );
    });

    it("leaves the paused picture unobstructed while text selection is enabled", () => {
      renderOverlays({
        snapshot: makeSnapshot({ buffer: "ok", intent: "paused" }),
        isTextSelectionEnabled: true,
      });

      expect(
        screen.queryByTestId("replay-overlay-paused"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("replay-select-text")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("leaves terminal replay pictures unobstructed while text selection is enabled", () => {
      const { rerender } = renderOverlays({
        snapshot: makeSnapshot({
          buffer: "ended",
          currentTimeMs: DURATION_MS,
        }),
        isLive: false,
        isTextSelectionEnabled: true,
      });

      expect(
        screen.queryByTestId("replay-overlay-ended"),
      ).not.toBeInTheDocument();

      rerender(
        <ReplayStageOverlays
          {...makeProps({
            snapshot: makeSnapshot({ buffer: "ended" }),
            isLive: true,
            isTextSelectionEnabled: true,
          })}
        >
          <div data-testid="fake-stage">stage</div>
        </ReplayStageOverlays>,
      );
      expect(
        screen.queryByTestId("replay-overlay-live-caught-up"),
      ).not.toBeInTheDocument();

      rerender(
        <ReplayStageOverlays
          {...makeProps({
            snapshot: makeSnapshot({
              buffer: "halted",
              error: { message: "Playback stopped", retryable: true },
            }),
            isTextSelectionEnabled: true,
          })}
        >
          <div data-testid="fake-stage">stage</div>
        </ReplayStageOverlays>,
      );
      expect(
        screen.queryByTestId("replay-overlay-error"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("fake-stage")).toBeInTheDocument();
    });

    it("shows the loading pill before the first frame", () => {
      renderOverlays({ snapshot: makeSnapshot({ buffer: "empty" }) });

      expect(screen.getByTestId("replay-overlay-loading")).toHaveTextContent(
        "Loading footage",
      );
    });
  });

  describe("top strip", () => {
    it("offers to skip the idle band the playhead is in, and names background-tab spans", () => {
      const idle: ReplayIdleBand = {
        startMs: 40000,
        endMs: 82000,
        kind: "idle",
        fidelity: "coarse",
      };
      const props: ReplayStageOverlaysProps = makeProps({
        snapshot: makeSnapshot({
          buffer: "ok",
          intent: "playing",
          idleBands: [idle],
        }),
      });

      const { rerender } = render(<ReplayStageOverlays {...props} />);

      const chip: HTMLElement = screen.getByTestId("replay-idle-chip");

      expect(chip).toHaveTextContent("Idle 42s (approx.)");
      expect(chip).toHaveTextContent("skip");
      expect(chip).toHaveAttribute("data-fidelity", "coarse");

      fireEvent.click(chip);
      expect(props.onSkipIdle).toHaveBeenCalledWith(idle);

      rerender(
        <ReplayStageOverlays
          {...makeProps({
            snapshot: makeSnapshot({
              buffer: "ok",
              intent: "playing",
              currentTimeMs: 150000,
              idleBands: [
                {
                  startMs: 100000,
                  endMs: 220000,
                  kind: "background-tab",
                  fidelity: "exact",
                },
              ],
            }),
          })}
        />,
      );

      expect(
        screen.getByTestId("replay-background-tab-chip"),
      ).toHaveTextContent("Tab was in the background for 2m");
    });

    it("does not offer a skip when the band is about to end", () => {
      const props: ReplayStageOverlaysProps = makeProps({
        snapshot: makeSnapshot({
          buffer: "ok",
          intent: "playing",
          currentTimeMs: 41200,
          idleBands: [
            { startMs: 30000, endMs: 42000, kind: "idle", fidelity: "exact" },
          ],
        }),
      });

      render(<ReplayStageOverlays {...props} />);

      const chip: HTMLElement = screen.getByTestId("replay-idle-chip");

      expect(chip).toBeDisabled();
      fireEvent.click(chip);
      expect(props.onSkipIdle).not.toHaveBeenCalled();
    });

    it("renders the engine's seek-clamped notice and the shell's transient notice", () => {
      renderOverlays({
        snapshot: makeSnapshot({
          notice: {
            kind: "seek-clamped",
            message:
              "No snapshot before 0:42; the earliest playable moment is 1:00",
            requestedMs: 42000,
            landedAtMs: 60000,
          },
        }),
        shellNotice: "Opened at the moment of the linked log line",
      });

      expect(screen.getByTestId("replay-overlay-notice")).toHaveTextContent(
        "No snapshot before 0:42",
      );
      expect(
        screen.getByTestId("replay-overlay-shell-notice"),
      ).toHaveTextContent("Opened at the moment of the linked log line");
    });

    it("removes every top-strip obstruction while selecting replay text", () => {
      renderOverlays({
        snapshot: makeSnapshot({
          intent: "paused",
          idleBands: [
            {
              startMs: 40000,
              endMs: 82000,
              kind: "idle",
              fidelity: "exact",
            },
          ],
          notice: {
            kind: "seek-clamped",
            message: "The seek landed on the first available snapshot",
            requestedMs: 1000,
            landedAtMs: 40000,
          },
        }),
        shellNotice: "Opened at the linked event",
        isTextSelectionEnabled: true,
      });

      expect(screen.queryByTestId("replay-idle-chip")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("replay-overlay-notice"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("replay-overlay-shell-notice"),
      ).not.toBeInTheDocument();
    });
  });

  describe("no-footage mode", () => {
    it("replaces the stage with an expired EmptyState that quotes the retention and keeps the phase word", () => {
      render(
        <ReplayStageOverlays
          {...makeProps({
            absence: {
              kind: "expired",
              expiresAtUnixMs: new Date(2026, 8, 11).getTime(),
              retentionDays: 7,
            },
          })}
        >
          <div data-testid="fake-stage">stage</div>
        </ReplayStageOverlays>,
      );

      const absent: HTMLElement = screen.getByTestId("replay-footage-absent");

      expect(absent).toHaveAttribute("data-kind", "expired");
      expect(absent).toHaveTextContent("Footage expired");
      expect(absent).toHaveTextContent("after 7 days per your retention");
      /*
       * ux-09: the copy must not promise that session metadata outlives
       * the footage - RumSession gives the header the same retentionDate
       * as its chunks. What genuinely survives is the telemetry.
       */
      expect(absent).toHaveTextContent(
        "follow the telemetry retention, not the recording's",
      );
      expect(absent).not.toHaveTextContent("kept longer");
      /* The stage is not mounted, so this file owns the one phase word. */
      expect(screen.queryByTestId("fake-stage")).not.toBeInTheDocument();
      expect(screen.getByTestId("replay-phase")).toHaveTextContent("expired");
      expect(screen.queryByTestId("replay-url-bar")).not.toBeInTheDocument();
    });

    it("explains a lost recording, a live session with nothing flushed, and a finalized empty one", () => {
      const { rerender } = render(
        <ReplayStageOverlays
          {...makeProps({ absence: { kind: "recording-lost" } })}
        />,
      );

      expect(screen.getByTestId("replay-footage-absent")).toHaveTextContent(
        "Recording lost",
      );
      expect(screen.getByTestId("replay-phase")).toHaveTextContent("lost");

      rerender(
        <ReplayStageOverlays
          {...makeProps({ absence: { kind: "not-yet-uploaded" } })}
        />,
      );

      expect(screen.getByTestId("replay-footage-absent")).toHaveTextContent(
        "Waiting for the first chunk",
      );
      expect(screen.getByTestId("replay-footage-absent")).toHaveTextContent(
        "every 30 seconds",
      );

      rerender(
        <ReplayStageOverlays
          {...makeProps({
            absence: { kind: "none-stored" },
            sealedReason: {
              title: "Recording ended after inactivity",
              description: "No chunk arrived for the idle window.",
              severity: "info",
            },
          })}
        />,
      );

      expect(screen.getByTestId("replay-footage-absent")).toHaveTextContent(
        "No footage was stored",
      );
      expect(
        screen.getByTestId("replay-footage-absent-sealed"),
      ).toHaveTextContent("Recording ended after inactivity");
    });

    /*
     * github.com/OneUptime/oneuptime/issues/3642: "none stored" is also
     * what a session whose every tab closed with nothing playable reads,
     * before the finalizer has run - so its fallback copy may not claim
     * the session was finalized.
     */
    it("a session that ended with nothing stored is not described as finalized", () => {
      render(
        <ReplayStageOverlays
          {...makeProps({ absence: { kind: "none-stored" } })}
        />,
      );

      const absent: HTMLElement = screen.getByTestId("replay-footage-absent");

      expect(absent).toHaveTextContent("No footage was stored");
      expect(absent).toHaveTextContent(
        "The session ended without a single chunk of footage.",
      );
      expect(absent).not.toHaveTextContent("finalized");
      expect(absent).not.toHaveTextContent("Waiting for the first chunk");
    });

    it("does not render its own phase word while a stage is mounted", () => {
      renderOverlays();

      expect(screen.queryByTestId("replay-phase")).not.toBeInTheDocument();
    });
  });
});
