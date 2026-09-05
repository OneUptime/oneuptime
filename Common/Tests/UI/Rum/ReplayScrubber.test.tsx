import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
 * The Dashboard resolves its own copy of react, which would give the component
 * a different hook dispatcher than the one react-dom renders with. Pinned in
 * Common's jest moduleNameMapper rather than mocked by absolute path here -
 * see ReplayStage.test.tsx for why the path-based version broke CI.
 */
import ReplayScrubber, {
  REPLAY_SPEEDS,
  ReplayScrubberProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScrubber";
import {
  ReplayEngineSnapshot,
  derivePhase,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";
import {
  ReplayTimelineMarker,
  buildExactMarkers,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineMath";
import { ReplaySignal } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";

/*
 * The composition: controls + timeline + one keyboard listener + the "?"
 * sheet. The timeline's own gestures are covered in ReplayTimeline.test.tsx;
 * here the subject is the glue - prev/next error stepping whose enabled
 * state and behaviour share one rule, the speed control, the toggle, and
 * the keyboard rules the old scrubber got wrong (focused buttons killed
 * the arrows, auto-repeat seeked per repeat, Alt+Left was swallowed, the
 * listener churned every tick).
 */

const DURATION_MS: number = 600000;

function makeSnapshot(
  overrides?: Partial<ReplayEngineSnapshot>,
): ReplayEngineSnapshot {
  const buffer: ReplayEngineSnapshot["buffer"] = overrides?.buffer ?? "ok";
  const intent: ReplayEngineSnapshot["intent"] = overrides?.intent ?? "paused";

  return {
    phase: derivePhase(buffer, intent),
    intent: intent,
    buffer: buffer,
    currentTimeMs: 0,
    durationMs: DURATION_MS,
    speed: 1,
    skipInactive: false,
    fedRange: { fromMs: 0, toMs: 60000 },
    loadedChunkIndexes: [0, 1, 2, 3],
    activeTabId: "tab-1",
    recordedSize: null,
    bufferingSinceMs: null,
    lastGap: null,
    lastIdleSkip: null,
    error: null,
    pendingSeekMs: null,
    generation: 1,
    ...overrides,
  };
}

function signal(
  overrides: Partial<ReplaySignal> & { id: string },
): ReplaySignal {
  return {
    kind: "client-error",
    source: "recording",
    offsetMs: 0,
    severity: "error",
    title: overrides.id,
    links: {},
    detail: {},
    ...overrides,
  };
}

function makeProps(
  overrides?: Partial<ReplayScrubberProps>,
): ReplayScrubberProps {
  return {
    snapshot: makeSnapshot(),
    bands: [],
    markers: [],
    onSeek: (): void => {
      // overridden per test
    },
    onPlayPause: (): void => {
      // overridden per test
    },
    onSpeedChange: (): void => {
      // overridden per test
    },
    onSkipInactiveChange: (): void => {
      // overridden per test
    },
    ...overrides,
  };
}

const ERROR_MARKERS: Array<ReplayTimelineMarker> = buildExactMarkers([
  signal({ id: "rec:1:0", offsetMs: 20000, title: "first" }),
  signal({ id: "rec:1:1", offsetMs: 21000, title: "second" }),
  signal({ id: "rec:4:0", offsetMs: 60000, title: "third" }),
]);

describe("ReplayScrubber controls", () => {
  it("renders the clock with tenths while paused and whole seconds while playing", () => {
    const { rerender } = render(
      <ReplayScrubber
        {...makeProps({ snapshot: makeSnapshot({ currentTimeMs: 12340 }) })}
      />,
    );

    expect(screen.getByTestId("replay-time")).toHaveTextContent(
      "0:12.3 / 10:00",
    );

    rerender(
      <ReplayScrubber
        {...makeProps({
          snapshot: makeSnapshot({ currentTimeMs: 12340, intent: "playing" }),
        })}
      />,
    );

    expect(screen.getByTestId("replay-time")).toHaveTextContent("0:12 / 10:00");
  });

  it("names the play button by phase, never by a bare boolean", () => {
    const cases: Array<[Partial<ReplayEngineSnapshot>, string, string]> = [
      [{ buffer: "ok", intent: "paused" }, "paused", "Play (Space)"],
      [{ buffer: "ok", intent: "playing" }, "playing", "Pause (Space)"],
      [{ buffer: "stalled", intent: "playing" }, "buffering", "Pause (Space)"],
      [{ buffer: "empty" }, "loading", "Loading footage"],
      [{ buffer: "ended" }, "ended", "Watch again (Space)"],
      [{ buffer: "halted" }, "error", "Retry"],
    ];

    for (const [overrides, phase, label] of cases) {
      const { unmount } = render(
        <ReplayScrubber
          {...makeProps({ snapshot: makeSnapshot(overrides) })}
        />,
      );

      const button: HTMLElement = screen.getByTestId("replay-play-pause");

      expect(button.getAttribute("data-phase")).toBe(phase);
      expect(button.getAttribute("aria-label")).toBe(label);
      expect(button.hasAttribute("disabled")).toBe(phase === "loading");

      unmount();
    }
  });

  it("routes the error-phase button to onRetry and shows the domain message", () => {
    let retries: number = 0;
    let toggles: number = 0;

    render(
      <ReplayScrubber
        {...makeProps({
          snapshot: makeSnapshot({
            buffer: "halted",
            error: { message: "Chunk 4 could not be fetched", retryable: true },
          }),
          onRetry: (): void => {
            retries++;
          },
          onPlayPause: (): void => {
            toggles++;
          },
        })}
      />,
    );

    expect(screen.getByTestId("replay-error-pill")).toHaveTextContent(
      "Chunk 4 could not be fetched",
    );

    fireEvent.click(screen.getByTestId("replay-play-pause"));

    expect(retries).toBe(1);
    expect(toggles).toBe(0);
  });

  it("offers every REPLAY_SPEEDS value, including 1.5x and 3x, from a radiogroup", () => {
    const speeds: Array<number> = [];

    render(
      <ReplayScrubber
        {...makeProps({
          onSpeedChange: (speed: number): void => {
            speeds.push(speed);
          },
        })}
      />,
    );

    expect(REPLAY_SPEEDS).toContain(1.5);
    expect(REPLAY_SPEEDS).toContain(3);

    const trigger: HTMLElement = screen.getByTestId("replay-speed");

    expect(trigger).toHaveTextContent("1x");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);

    const group: HTMLElement = screen.getByRole("radiogroup", {
      name: "Playback speed",
    });
    const radios: Array<HTMLElement> = screen.getAllByRole("radio");

    expect(
      radios.map((radio: HTMLElement) => {
        return radio.textContent;
      }),
    ).toEqual(
      REPLAY_SPEEDS.map((speed: number) => {
        return `${speed}x`;
      }),
    );
    expect(
      radios.find((radio: HTMLElement) => {
        return radio.getAttribute("aria-checked") === "true";
      })?.textContent,
    ).toBe("1x");

    fireEvent.click(screen.getByTestId("replay-speed-option-2"));

    expect(speeds).toEqual([2]);
    expect(group).not.toBeInTheDocument();
  });

  it("emits the skip-idle toggle", () => {
    const values: Array<boolean> = [];

    render(
      <ReplayScrubber
        {...makeProps({
          onSkipInactiveChange: (isEnabled: boolean): void => {
            values.push(isEnabled);
          },
        })}
      />,
    );

    const toggle: HTMLElement = screen.getByTestId("replay-skip-idle");

    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    expect(values).toEqual([true]);
  });

  it("seeks +-10s from the buttons relative to the latest playhead", () => {
    const seeks: Array<number> = [];

    render(
      <ReplayScrubber
        {...makeProps({
          snapshot: makeSnapshot({ currentTimeMs: 5000 }),
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("replay-seek-back"));
    fireEvent.click(screen.getByTestId("replay-seek-forward"));

    expect(seeks).toEqual([0, 15000]);
  });
});

describe("ReplayScrubber error stepping", () => {
  it("disables prev at the start and next at the end", () => {
    const { rerender } = render(
      <ReplayScrubber {...makeProps({ markers: ERROR_MARKERS })} />,
    );

    expect(screen.getByTestId("replay-prev-error")).toBeDisabled();
    expect(screen.getByTestId("replay-next-error")).toBeEnabled();

    rerender(
      <ReplayScrubber
        {...makeProps({
          markers: ERROR_MARKERS,
          snapshot: makeSnapshot({ currentTimeMs: 60000 }),
        })}
      />,
    );

    expect(screen.getByTestId("replay-prev-error")).toBeEnabled();
    expect(screen.getByTestId("replay-next-error")).toBeDisabled();
  });

  it("advances through every error, landing a second early, and selects each row", () => {
    /*
     * Regression for scrubber-devtools-2 / player-shell-1: the old button
     * landed 10s before the marker and then re-found the same marker on
     * the next press because it was still ahead of the playhead.
     */
    const seeks: Array<number> = [];
    const selected: Array<string> = [];
    let snapshot: ReplayEngineSnapshot = makeSnapshot();

    const renderAt: (currentTimeMs: number) => ReplayScrubberProps = (
      currentTimeMs: number,
    ): ReplayScrubberProps => {
      snapshot = makeSnapshot({ currentTimeMs: currentTimeMs });

      return makeProps({
        markers: ERROR_MARKERS,
        snapshot: snapshot,
        onSeek: (offsetMs: number): void => {
          seeks.push(offsetMs);
        },
        onSelectSignal: (signalId: string): void => {
          selected.push(signalId);
        },
      });
    };

    const { rerender } = render(<ReplayScrubber {...renderAt(0)} />);

    fireEvent.click(screen.getByTestId("replay-next-error"));
    rerender(<ReplayScrubber {...renderAt(seeks[seeks.length - 1]!)} />);
    fireEvent.click(screen.getByTestId("replay-next-error"));
    rerender(<ReplayScrubber {...renderAt(seeks[seeks.length - 1]!)} />);
    fireEvent.click(screen.getByTestId("replay-next-error"));
    rerender(<ReplayScrubber {...renderAt(seeks[seeks.length - 1]!)} />);

    expect(seeks).toEqual([19000, 20000, 59000]);
    expect(selected).toEqual(["rec:1:0", "rec:1:1", "rec:4:0"]);
    expect(screen.getByTestId("replay-next-error")).toBeDisabled();

    fireEvent.click(screen.getByTestId("replay-prev-error"));

    expect(seeks[seeks.length - 1]).toBe(20000);
    expect(selected[selected.length - 1]).toBe("rec:1:1");
  });

  it("steps frustration markers with the same rule", () => {
    const seeks: Array<number> = [];
    const markers: Array<ReplayTimelineMarker> = buildExactMarkers([
      signal({
        id: "rec:2:0",
        kind: "frustration",
        severity: "warn",
        offsetMs: 45000,
      }),
    ]);

    render(
      <ReplayScrubber
        {...makeProps({
          markers: markers,
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("replay-next-frustration"));

    expect(seeks).toEqual([44000]);
  });
});

describe("ReplayScrubber keyboard shortcuts", () => {
  it("toggles play/pause on Space when nothing focusable owns the key", () => {
    let toggles: number = 0;

    render(
      <ReplayScrubber
        {...makeProps({
          onPlayPause: (): void => {
            toggles++;
          },
        })}
      />,
    );

    fireEvent.keyDown(document.body, { key: " " });

    expect(toggles).toBe(1);
  });

  it("leaves Space alone when a button has focus but still answers the arrows there", () => {
    /*
     * Finding scrubber-devtools-1. Clicking Play leaves the button
     * focused; Space must activate the button (not double-fire), while
     * ArrowRight must still seek - the most common gesture in the player.
     */
    let toggles: number = 0;
    const seeks: Array<number> = [];

    render(
      <ReplayScrubber
        {...makeProps({
          snapshot: makeSnapshot({ currentTimeMs: 30000 }),
          onPlayPause: (): void => {
            toggles++;
          },
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
        })}
      />,
    );

    const playButton: HTMLElement = screen.getByTestId("replay-play-pause");

    fireEvent.keyDown(playButton, { key: " " });
    fireEvent.keyDown(playButton, { key: "ArrowRight" });
    fireEvent.keyDown(playButton, { key: "," });
    fireEvent.keyDown(playButton, { key: "k" });

    expect(toggles).toBe(1);
    expect(seeks).toEqual([35000, 29000]);
  });

  it("never steals keys from a text field", () => {
    let toggles: number = 0;
    const seeks: Array<number> = [];

    render(
      <div>
        <input data-testid="search" />
        <ReplayScrubber
          {...makeProps({
            onPlayPause: (): void => {
              toggles++;
            },
            onSeek: (offsetMs: number): void => {
              seeks.push(offsetMs);
            },
          })}
        />
      </div>,
    );

    const input: HTMLElement = screen.getByTestId("search");

    fireEvent.keyDown(input, { key: " " });
    fireEvent.keyDown(input, { key: "ArrowRight" });
    fireEvent.keyDown(input, { key: "e" });

    expect(toggles).toBe(0);
    expect(seeks).toEqual([]);
  });

  it("leaves Alt/Ctrl/Meta chords to the browser", () => {
    const seeks: Array<number> = [];
    let copies: number = 0;

    render(
      <ReplayScrubber
        {...makeProps({
          snapshot: makeSnapshot({ currentTimeMs: 30000 }),
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
          onCopyLink: (): void => {
            copies++;
          },
        })}
      />,
    );

    const alt: KeyboardEvent = new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });

    fireEvent(document.body, alt);
    fireEvent.keyDown(document.body, { key: "c", metaKey: true });

    expect(seeks).toEqual([]);
    expect(copies).toBe(0);
    expect(alt.defaultPrevented).toBe(false);
  });

  it("commits a held arrow key as one seek at press and one at release", () => {
    /*
     * Finding scrubber-devtools-10: auto-repeat used to seek per repeat,
     * one Replayer rebuild each. Press seeks immediately; repeats
     * accumulate; keyup commits the accumulated delta once.
     */
    const seeks: Array<number> = [];

    render(
      <ReplayScrubber
        {...makeProps({
          snapshot: makeSnapshot({ currentTimeMs: 30000 }),
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
        })}
      />,
    );

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight", repeat: true });
    fireEvent.keyDown(document.body, { key: "ArrowRight", repeat: true });
    fireEvent.keyDown(document.body, { key: "ArrowRight", repeat: true });

    expect(seeks).toEqual([35000]);

    fireEvent.keyUp(document.body, { key: "ArrowRight" });

    /* 3 repeats x 5s, applied to the latest playhead the parent reported. */
    expect(seeks).toEqual([35000, 45000]);
  });

  it("ignores auto-repeat for one-shot keys like Space", () => {
    let toggles: number = 0;

    render(
      <ReplayScrubber
        {...makeProps({
          onPlayPause: (): void => {
            toggles++;
          },
        })}
      />,
    );

    fireEvent.keyDown(document.body, { key: " " });
    fireEvent.keyDown(document.body, { key: " ", repeat: true });
    fireEvent.keyDown(document.body, { key: " ", repeat: true });

    expect(toggles).toBe(1);
  });

  it("covers the full vocabulary: j/l, digits, Home/End, speed, skip idle, errors, view keys", () => {
    const seeks: Array<number> = [];
    const speeds: Array<number> = [];
    const skips: Array<boolean> = [];
    const calls: Array<string> = [];
    const record: (name: string) => () => void = (
      name: string,
    ): (() => void) => {
      return (): void => {
        calls.push(name);
      };
    };

    render(
      <ReplayScrubber
        {...makeProps({
          snapshot: makeSnapshot({ currentTimeMs: 30000, speed: 2 }),
          markers: ERROR_MARKERS,
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
          onSpeedChange: (speed: number): void => {
            speeds.push(speed);
          },
          onSkipInactiveChange: (isEnabled: boolean): void => {
            skips.push(isEnabled);
          },
          onSkipIdleJump: record("skip-idle-jump"),
          onNextSignal: record("next-signal"),
          onPrevSignal: record("prev-signal"),
          onToggleTheater: record("theater"),
          onToggleWide: record("wide"),
          onFollowChange: (isEnabled: boolean): void => {
            calls.push(`follow:${isEnabled}`);
          },
          onFocusRailSearch: record("rail-search"),
          onCopyLink: record("copy"),
          onToggleDetails: record("details"),
          onEscape: record("escape"),
        })}
      />,
    );

    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyUp(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "l" });
    fireEvent.keyUp(document.body, { key: "l" });
    fireEvent.keyDown(document.body, { key: "5" });
    fireEvent.keyDown(document.body, { key: "Home" });
    fireEvent.keyDown(document.body, { key: "End" });
    fireEvent.keyDown(document.body, { key: "e" });

    expect(seeks).toEqual([20000, 40000, 300000, 0, DURATION_MS, 59000]);

    fireEvent.keyDown(document.body, { key: ">", shiftKey: true });
    fireEvent.keyDown(document.body, { key: "<", shiftKey: true });

    expect(speeds).toEqual([3, 1.5]);

    fireEvent.keyDown(document.body, { key: "S", shiftKey: true });

    expect(skips).toEqual([true]);

    fireEvent.keyDown(document.body, { key: "s" });
    fireEvent.keyDown(document.body, { key: "]" });
    fireEvent.keyDown(document.body, { key: "[" });
    fireEvent.keyDown(document.body, { key: "f" });
    fireEvent.keyDown(document.body, { key: "w" });
    fireEvent.keyDown(document.body, { key: "m" });
    fireEvent.keyDown(document.body, { key: "/" });
    fireEvent.keyDown(document.body, { key: "c" });
    fireEvent.keyDown(document.body, { key: "i" });
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(calls).toEqual([
      "skip-idle-jump",
      "next-signal",
      "prev-signal",
      "theater",
      "wide",
      "follow:true",
      "rail-search",
      "copy",
      "details",
      "escape",
    ]);
  });

  it("uses the rail vocabulary when the scope says the rail has focus", () => {
    const calls: Array<string> = [];

    render(
      <ReplayScrubber
        {...makeProps({
          keyboardScope: "rail",
          onRailRowDown: (): void => {
            calls.push("down");
          },
          onRailRowUp: (): void => {
            calls.push("up");
          },
          onRailSeekSelected: (): void => {
            calls.push("seek");
          },
          onRailClear: (): void => {
            calls.push("clear");
          },
        })}
      />,
    );

    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "k" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(calls).toEqual(["down", "up", "seek", "clear"]);
  });

  it("does nothing while shortcuts are disabled", () => {
    let toggles: number = 0;

    render(
      <ReplayScrubber
        {...makeProps({
          areShortcutsEnabled: false,
          onPlayPause: (): void => {
            toggles++;
          },
        })}
      />,
    );

    fireEvent.keyDown(document.body, { key: " " });

    expect(toggles).toBe(0);
  });

  it("registers one window keydown listener for its lifetime, not one per tick", () => {
    /*
     * Finding scrubber-devtools-20: the old effect depended on
     * currentTimeMs and re-subscribed five times a second.
     */
    const added: Array<string> = [];
    const original: typeof window.addEventListener = window.addEventListener;

    window.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void => {
      added.push(type);
      original.call(window, type, listener, options);
    }) as typeof window.addEventListener;

    try {
      const { rerender } = render(
        <ReplayScrubber
          {...makeProps({ snapshot: makeSnapshot({ currentTimeMs: 0 }) })}
        />,
      );

      const keydownsAfterMount: number = added.filter((type: string) => {
        return type === "keydown";
      }).length;

      for (let tick: number = 1; tick <= 5; tick++) {
        rerender(
          <ReplayScrubber
            {...makeProps({
              snapshot: makeSnapshot({ currentTimeMs: tick * 200 }),
            })}
          />,
        );
      }

      const keydownsAfterTicks: number = added.filter((type: string) => {
        return type === "keydown";
      }).length;

      expect(keydownsAfterMount).toBeGreaterThanOrEqual(1);
      expect(keydownsAfterTicks).toBe(keydownsAfterMount);
    } finally {
      window.addEventListener = original;
    }
  });
});

describe("ReplayScrubber shortcuts sheet", () => {
  it("opens on ? and from the button, and closes on Escape", () => {
    let escapes: number = 0;

    render(
      <ReplayScrubber
        {...makeProps({
          onEscape: (): void => {
            escapes++;
          },
        })}
      />,
    );

    expect(screen.queryByTestId("keyboard-shortcuts-modal")).toBeNull();

    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });

    expect(screen.getByTestId("keyboard-shortcuts-modal")).toBeInTheDocument();
    expect(screen.getByTestId("shortcut-group-playback")).toBeInTheDocument();
    expect(screen.getByTestId("shortcut-next-error")).toHaveTextContent(
      "Next error",
    );

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByTestId("keyboard-shortcuts-modal")).toBeNull();
    /* Escape closed the sheet; it did not also reach the page. */
    expect(escapes).toBe(0);

    fireEvent.click(screen.getByTestId("replay-shortcuts-button"));

    expect(screen.getByTestId("keyboard-shortcuts-modal")).toBeInTheDocument();
  });
});

describe("ReplayScrubber buffering pill", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("appears only after the grace period and offers Retry after the hint delay", () => {
    let retries: number = 0;

    render(
      <ReplayScrubber
        {...makeProps({
          snapshot: makeSnapshot({ buffer: "stalled", intent: "playing" }),
          onRetry: (): void => {
            retries++;
          },
        })}
      />,
    );

    expect(screen.queryByTestId("replay-buffering-pill")).toBeNull();

    act((): void => {
      jest.advanceTimersByTime(300);
    });

    const pill: HTMLElement = screen.getByTestId("replay-buffering-pill");

    expect(pill).toHaveTextContent("Loading footage");

    act((): void => {
      jest.advanceTimersByTime(8000);
    });

    expect(screen.getByTestId("replay-buffering-pill")).toHaveTextContent(
      "Still loading",
    );

    /*
     * ux-18: the stage overlay announces the phase and owns the Retry.
     * The controls pill is the same words in a second place, so it is
     * visual only - not a live region, and without a duplicate Retry
     * button that a screen reader would read as a second offer.
     */
    expect(pill).not.toHaveAttribute("role", "status");
    expect(pill).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByTestId("replay-buffering-retry")).toBeNull();
    expect(retries).toBe(0);
  });

  it("names the seek target while seeking", () => {
    render(
      <ReplayScrubber
        {...makeProps({
          snapshot: makeSnapshot({
            buffer: "building",
            intent: "paused",
            currentTimeMs: 72000,
            pendingSeekMs: 72000,
          }),
        })}
      />,
    );

    act((): void => {
      jest.advanceTimersByTime(300);
    });

    expect(screen.getByTestId("replay-buffering-pill")).toHaveTextContent(
      "Seeking to 1:12",
    );
  });
});
