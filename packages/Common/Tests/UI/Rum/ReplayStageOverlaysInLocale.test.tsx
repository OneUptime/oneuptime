import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
/*
 * The Dashboard has its own copy of react; Common's jest moduleNameMapper
 * pins react and react-dom to this project's single copy for every
 * importer (see the note at the top of ReplayStage.test.tsx).
 */
import * as React from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  composedValue,
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

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

import ReplayStageOverlays, {
  REPLAY_PAUSED_BAND_EXPLANATION,
  ReplayStageOverlaysProps,
  describeIdleBandChip,
  describeIdleSkip,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayStageOverlays";
import {
  REPLAY_BUFFERING_GRACE_MS,
  REPLAY_BUFFERING_RETRY_HINT_MS,
  ReplayEngineSnapshot,
  ReplayIdleBand,
  derivePhase,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";

/*
 * The stage's overlays in the reader's language (#6369). The error card,
 * the loading, seeking and buffering pills, the gap and idle-skip toasts,
 * the live wait, the ended card, the paused button, the address bar, the
 * idle chips and their tooltips, the engine's and the shell's notices and
 * the no-footage states all read English in every language. Each is
 * looked up whole now, its values - offsets, durations, a tab's label, a
 * date, the retention's days - in place.
 */

const MARKING: Translator = createTranslator((text: string): string => {
  return `⟦${text}⟧`;
}, "de");

const DURATION_MS: number = 252000;

// What is left of an element's text once every marked lookup is taken out.
function unmarkedText(element: HTMLElement): string {
  let text: string = element.textContent || "";
  let previous: string = "";

  while (text !== previous) {
    previous = text;
    text = text.replace(/⟦[^⟦⟧]*⟧/g, "");
  }

  return text.trim();
}

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

function makeProps(
  overrides?: Partial<ReplayStageOverlaysProps>,
): ReplayStageOverlaysProps {
  return {
    snapshot: makeSnapshot(),
    signals: [],
    chunks: [],
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
      <div data-testid="fake-stage" />
    </ReplayStageOverlays>,
  );
}

function band(kind: ReplayIdleBand["kind"]): ReplayIdleBand {
  return { startMs: 1000, endMs: 73000, kind: kind, fidelity: "exact" };
}

afterEach((): void => {
  jest.useRealTimers();
});

describe("the band describers, given a translator", () => {
  it("look each sentence up whole, with the duration in place", () => {
    expect(describeIdleSkip(band("idle"), MARKING)).toBe(
      "⟦Skipped 1m 12s idle⟧",
    );
    expect(describeIdleSkip(band("background-tab"), MARKING)).toBe(
      "⟦Skipped 1m 12s in the background⟧",
    );
    expect(describeIdleSkip(band("paused"), MARKING)).toBe(
      "⟦Skipped 1m 12s: recording paused while the page was idle⟧",
    );
    expect(describeIdleBandChip(band("background-tab"), MARKING)).toBe(
      "⟦Tab was in the background for 1m 12s⟧",
    );
    expect(describeIdleBandChip(band("paused"), MARKING)).toBe(
      "⟦Recording paused · 1m 12s⟧",
    );
    expect(describeIdleBandChip(band("idle"), MARKING)).toBe("⟦Idle 1m 12s⟧");
    expect(
      describeIdleBandChip({ ...band("idle"), fidelity: "coarse" }, MARKING),
    ).toBe("⟦Idle 1m 12s (approx.)⟧");
  });

  it("write the English word for word without one", () => {
    expect(describeIdleSkip(band("paused"))).toBe(
      "Skipped 1m 12s: recording paused while the page was idle",
    );
    expect(describeIdleBandChip({ ...band("idle"), fidelity: "coarse" })).toBe(
      "Idle 1m 12s (approx.)",
    );
    expect(describeIdleBandChip(band("paused"))).toBe(
      "Recording paused · 1m 12s",
    );
  });
});

describe("ReplayStageOverlays in the reader's language", () => {
  it("words the error card, the engine's own sentence included, and its buttons", () => {
    renderOverlays({
      snapshot: makeSnapshot({
        buffer: "halted",
        error: {
          message: "Footage from 0:41 could not be applied to the player: boom",
          wording: composedValue((translator: Translator): string => {
            return translator.translateTemplate(
              "Footage from {{time}} could not be applied to the player: {{reason}}",
              { time: "0:41", reason: "boom" },
            );
          }),
          retryable: true,
        },
      }),
    });

    const card: HTMLElement = screen.getByTestId("replay-overlay-error");

    expect(card).toHaveTextContent("⟦Playback stopped⟧");
    expect(card).toHaveTextContent(
      "⟦Footage from 0:41 could not be applied to the player: boom⟧",
    );
    expect(screen.getByTestId("replay-overlay-retry")).toHaveTextContent(
      "⟦Retry⟧",
    );
    expect(
      screen.getByTestId("replay-overlay-copy-diagnostic"),
    ).toHaveTextContent("⟦Copy diagnostic⟧");
    expect(unmarkedText(card)).toBe("");
    expect(card.textContent).not.toContain("⟦⟦");
  });

  it("looks up a fixed engine error by its English", () => {
    renderOverlays({
      snapshot: makeSnapshot({
        buffer: "halted",
        error: {
          message: "No footage is stored for this tab.",
          retryable: false,
        },
      }),
    });

    expect(screen.getByTestId("replay-overlay-error")).toHaveTextContent(
      "⟦No footage is stored for this tab.⟧",
    );
  });

  it("words the loading and seeking pills, the time in place", () => {
    const { unmount } = renderOverlays({
      snapshot: makeSnapshot({ buffer: "empty" }),
    });

    expect(screen.getByTestId("replay-overlay-loading")).toHaveTextContent(
      "⟦Loading footage⟧",
    );

    unmount();
    renderOverlays({
      snapshot: makeSnapshot({
        buffer: "building",
        intent: "paused",
        pendingSeekMs: 72000,
      }),
    });

    expect(screen.getByTestId("replay-overlay-seeking")).toHaveTextContent(
      "⟦Seeking to 1:12⟧",
    );
  });

  it("words the buffering pill and its Still loading retry", () => {
    jest.useFakeTimers();
    renderOverlays({
      snapshot: makeSnapshot({ buffer: "building", intent: "playing" }),
    });

    act((): void => {
      jest.advanceTimersByTime(REPLAY_BUFFERING_GRACE_MS);
    });

    expect(screen.getByTestId("replay-overlay-buffering")).toHaveTextContent(
      "⟦Buffering⟧",
    );

    act((): void => {
      jest.advanceTimersByTime(
        REPLAY_BUFFERING_RETRY_HINT_MS - REPLAY_BUFFERING_GRACE_MS,
      );
    });

    const pill: HTMLElement = screen.getByTestId("replay-overlay-buffering");

    expect(pill).toHaveTextContent("⟦Still loading⟧");
    expect(pill).toHaveTextContent("⟦Retry⟧");
    expect(unmarkedText(pill)).toBe("");
  });

  it("words a stall as waiting for the next footage", () => {
    jest.useFakeTimers();
    renderOverlays({
      snapshot: makeSnapshot({ buffer: "stalled", intent: "playing" }),
    });

    act((): void => {
      jest.advanceTimersByTime(REPLAY_BUFFERING_GRACE_MS);
    });

    expect(screen.getByTestId("replay-overlay-buffering")).toHaveTextContent(
      "⟦Waiting for the next footage⟧",
    );
  });

  it("words the gap and idle-skip toasts with the skipped length in place", () => {
    const { unmount } = renderOverlays({
      snapshot: makeSnapshot({
        buffer: "ok",
        intent: "playing",
        lastGap: { fromIndex: 2, toIndex: 4, missingMs: 18000 },
      }),
    });

    expect(screen.getByTestId("replay-overlay-gap")).toHaveTextContent(
      "⟦Skipped 18s - the recorder never delivered this stretch⟧",
    );

    unmount();
    renderOverlays({
      snapshot: makeSnapshot({
        buffer: "ok",
        intent: "playing",
        lastIdleSkip: band("paused"),
      }),
    });

    expect(screen.getByTestId("replay-overlay-idle-skip")).toHaveTextContent(
      "⟦Skipped 1m 12s: recording paused while the page was idle⟧",
    );
  });

  it("words the live wait", () => {
    renderOverlays({
      snapshot: makeSnapshot({ buffer: "ended", currentTimeMs: DURATION_MS }),
      isLive: true,
    });

    const wait: HTMLElement = screen.getByTestId(
      "replay-overlay-live-caught-up",
    );

    expect(wait).toHaveTextContent(
      "⟦Caught up with the live recording - waiting for the next chunk (checked every 30 seconds)⟧",
    );
    expect(unmarkedText(wait)).toBe("");
  });

  it("words the ended card: what played, Watch again, the next tab and the next session", () => {
    renderOverlays({
      snapshot: makeSnapshot({ buffer: "ended", currentTimeMs: DURATION_MS }),
      continueInTab: {
        tabId: "tab-3",
        label: "Tab 3",
        durationMs: 30000,
        openedAtMs: 134000,
        hasFootage: true,
        isActive: false,
      },
      onContinueInTab: jest.fn(),
      nextUserSession: {
        sessionId: "next-1",
        description: "Montag · /checkout · 4m",
      },
      onOpenNextUserSession: jest.fn(),
    });

    const ended: HTMLElement = screen.getByTestId("replay-overlay-ended");

    expect(ended).toHaveTextContent("⟦Replay ended⟧");
    expect(ended).toHaveTextContent("⟦4m 12s of footage played out.⟧");
    expect(screen.getByTestId("replay-watch-again")).toHaveTextContent(
      "⟦Watch again⟧",
    );
    expect(
      screen.getByTestId("replay-ended-continue-in-tab"),
    ).toHaveTextContent("⟦Continue in Tab 3⟧");

    const next: HTMLElement = screen.getByTestId("replay-ended-next-session");

    expect(next).toHaveTextContent("⟦Next session by this user⟧");
    // The shell words the tooltip in the reader's language: drawn as it is.
    expect(next).toHaveAttribute("title", "Montag · /checkout · 4m");
    expect(unmarkedText(ended)).toBe("");
    expect(ended.textContent).not.toContain("⟦⟦");
  });

  it("names the paused frame's Play button", () => {
    renderOverlays({ snapshot: makeSnapshot({ buffer: "ok" }) });

    const play: HTMLElement = screen.getByTestId("replay-overlay-paused");

    expect(play).toHaveAttribute("title", "⟦Play (Space)⟧");
    expect(play).toHaveAttribute("aria-label", "⟦Play⟧");
  });

  it("words the address bar, keeping the address itself as recorded", () => {
    const { unmount } = renderOverlays();

    const bar: HTMLElement = screen.getByTestId("replay-url-bar");

    expect(screen.getByTestId("replay-url-text")).toHaveTextContent(
      "https://app.acme.com/checkout",
    );
    expect(screen.getByTestId("replay-url-open")).toHaveAttribute(
      "aria-label",
      "⟦Open the page in a new tab⟧",
    );
    expect(screen.getByTestId("replay-url-open")).toHaveAttribute(
      "title",
      "⟦Open the page in a new tab⟧",
    );
    expect(screen.getByTestId("replay-viewport-chip")).toHaveAttribute(
      "title",
      "⟦Recorded viewport and the scale it is drawn at⟧",
    );
    // ReplayToolButton looks its own props up: once, never twice.
    expect(screen.getByTestId("replay-url-copy")).toHaveAttribute(
      "title",
      "⟦Copy the URL⟧",
    );
    expect(bar.innerHTML).not.toContain("⟦⟦");

    unmount();
    renderOverlays({ entryUrl: "" });

    const text: HTMLElement = screen.getByTestId("replay-url-text");

    expect(text).toHaveTextContent("⟦URL not recorded yet⟧");
    expect(text).toHaveAttribute("title", "⟦No page URL is known yet⟧");
  });

  it("words the idle chip, its tooltip and its skip", () => {
    renderOverlays({
      snapshot: makeSnapshot({
        buffer: "ok",
        intent: "playing",
        currentTimeMs: 2000,
        idleBands: [band("paused")],
      }),
    });

    const chip: HTMLElement = screen.getByTestId("replay-paused-chip");

    expect(chip).toHaveTextContent("⟦Recording paused · 1m 12s⟧");
    expect(chip).toHaveTextContent("⟦skip >⟧");
    expect(chip).toHaveAttribute(
      "title",
      `⟦${REPLAY_PAUSED_BAND_EXPLANATION}⟧ ⟦Skip past this stretch (s)⟧`,
    );
    expect(unmarkedText(chip)).toBe("");
  });

  it("composes the engine's notice and looks up the shell's, or composes its wording", () => {
    const { unmount } = renderOverlays({
      snapshot: makeSnapshot({
        notice: {
          kind: "seek-clamped",
          message:
            "No snapshot before 0:00; the earliest playable moment is 0:15.",
          wording: composedValue((translator: Translator): string => {
            return translator.translateTemplate(
              "No snapshot before {{requestedTime}}; the earliest playable moment is {{earliestTime}}.",
              { requestedTime: "0:00", earliestTime: "0:15" },
            );
          }),
          requestedMs: 0,
          landedAtMs: 15000,
        },
      }),
      shellNotice: "Opened at the linked moment",
    });

    expect(screen.getByTestId("replay-overlay-notice")).toHaveTextContent(
      "⟦No snapshot before 0:00; the earliest playable moment is 0:15.⟧",
    );
    expect(screen.getByTestId("replay-overlay-shell-notice")).toHaveTextContent(
      "⟦Opened at the linked moment⟧",
    );

    unmount();
    renderOverlays({
      shellNotice: composedValue((translator: Translator): string => {
        return translator.translateTemplate(
          "The recording carried on in {{tab}} - continuing there.",
          { tab: "Tab 2" },
        );
      }),
    });

    expect(screen.getByTestId("replay-overlay-shell-notice")).toHaveTextContent(
      "⟦The recording carried on in Tab 2 - continuing there.⟧",
    );
  });

  it("words an expired recording's empty state with the days and the date in place", () => {
    render(
      <ReplayStageOverlays
        {...makeProps({
          absence: {
            kind: "expired",
            expiresAtUnixMs: new Date(2026, 8, 11).getTime(),
            retentionDays: 7,
          },
        })}
      />,
    );

    const absent: HTMLElement = screen.getByTestId("replay-footage-absent");

    expect(absent).toHaveTextContent("⟦Footage expired⟧");
    expect(absent).toHaveTextContent(
      "⟦The recording expired after 7 days per your retention on ",
    );
    expect(absent).toHaveTextContent(
      "⟦Its logs, traces and exceptions follow the telemetry retention, not the recording's, so they still load in the rail; the session facts are in Details.⟧",
    );
    expect(screen.getByTestId("replay-phase")).toHaveTextContent("⟦expired⟧");
  });

  it("words the retention it does not know, and the other empty states' phase words", () => {
    const { rerender } = render(
      <ReplayStageOverlays
        {...makeProps({
          absence: {
            kind: "expired",
            expiresAtUnixMs: null,
            retentionDays: null,
          },
        })}
      />,
    );

    expect(screen.getByTestId("replay-footage-absent")).toHaveTextContent(
      "⟦The recording expired under the application's retention.⟧",
    );

    rerender(
      <ReplayStageOverlays
        {...makeProps({ absence: { kind: "not-yet-uploaded" } })}
      />,
    );

    expect(screen.getByTestId("replay-footage-absent")).toHaveTextContent(
      "⟦Waiting for the first chunk⟧",
    );
    expect(screen.getByTestId("replay-phase")).toHaveTextContent("⟦waiting⟧");

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

    expect(screen.getByTestId("replay-phase")).toHaveTextContent("⟦empty⟧");
    // The sealed reason's English copy, looked up where it is drawn.
    expect(
      screen.getByTestId("replay-footage-absent-sealed"),
    ).toHaveTextContent(
      "⟦Recording ended after inactivity⟧: ⟦No chunk arrived for the idle window.⟧",
    );

    rerender(
      <ReplayStageOverlays
        {...makeProps({ absence: { kind: "recording-lost" } })}
      />,
    );

    expect(screen.getByTestId("replay-phase")).toHaveTextContent("⟦lost⟧");
  });
});
