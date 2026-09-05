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
 * chunk row's URL and the entry URL); the viewport chip and the Fit / 1:1
 * toggle; overlay precedence error > seeking > buffering > gap > paused;
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

    it("says the URL is not recorded yet rather than showing a blank", () => {
      renderOverlays({ entryUrl: "", chunks: [] });

      expect(screen.getByTestId("replay-url-text")).toHaveTextContent(
        "URL not recorded yet",
      );
      expect(screen.queryByTestId("replay-url-open")).not.toBeInTheDocument();
      expect(screen.queryByTestId("replay-url-copy")).not.toBeInTheDocument();
    });

    it("toggles Fit / 1:1 through onFitChange and hides the percentage at 1:1", () => {
      const props: ReplayStageOverlaysProps = makeProps({ fit: "actual" });

      render(<ReplayStageOverlays {...props} />);

      expect(screen.getByTestId("replay-viewport-chip")).not.toHaveTextContent(
        "%",
      );

      fireEvent.click(screen.getByRole("button", { name: "Fit" }));
      expect(props.onFitChange).toHaveBeenCalledWith("contain");

      fireEvent.click(screen.getByRole("button", { name: "1:1" }));
      expect(props.onFitChange).toHaveBeenCalledWith("actual");
      expect(screen.getByRole("button", { name: "1:1" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("omits the viewport chip when no size is known", () => {
      renderOverlays({ recordedSize: null });

      expect(
        screen.queryByTestId("replay-viewport-chip"),
      ).not.toBeInTheDocument();
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
      expect(absent).toHaveTextContent("The session's signals are still here");
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

    it("does not render its own phase word while a stage is mounted", () => {
      renderOverlays();

      expect(screen.queryByTestId("replay-phase")).not.toBeInTheDocument();
    });
  });
});
