import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import LlmReplayBar from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmReplayBar";
import { LlmConversationReplayController } from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/useLlmConversationReplay";
import LlmConversationReplay from "../../../Utils/Telemetry/LlmConversationReplay";
import { LlmTranscriptStep, LlmTranscriptStepType } from "../../../Utils/Telemetry/LlmConversationTranscript";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import { T0, makeStep } from "./LlmConversationFixtures";

/*
 * The replay's transport: play, back and forward through the messages, the
 * speed, "Skip waiting", where the replay is, and a scrubber whose dots are
 * the messages. Driven here by a stand-in controller, so each test says
 * exactly which state the bar is drawn in and which call a control makes.
 */

const STEPS: Array<LlmTranscriptStep> = [
  makeStep(LlmTranscriptStepType.UserMessage, { atMs: T0, text: "Hi" }),
  makeStep(LlmTranscriptStepType.AssistantMessage, { atMs: T0 + 2000, text: "Hello" }),
  makeStep(LlmTranscriptStepType.ToolCall, { atMs: T0 + 3000, toolName: "search" }),
  makeStep(LlmTranscriptStepType.AssistantMessage, {
    atMs: T0 + 6000,
    text: "No.",
    issues: [LlmAnswerIssue.Refused],
  }),
];

type Controller = LlmConversationReplayController & {
  [K in
    | "play"
    | "pause"
    | "togglePlay"
    | "next"
    | "previous"
    | "restart"
    | "goToEnd"
    | "goToStep"
    | "seekToProgress"
    | "cycleSpeed"
    | "setSkipWaiting"]: jest.Mock;
};

function controller(
  state: Partial<LlmConversationReplayController> = {},
  steps: ReadonlyArray<LlmTranscriptStep> = STEPS,
): Controller {
  const timeline: LlmConversationReplayController["timeline"] =
    LlmConversationReplay.buildTimeline(steps, { skipWaiting: true });
  const clockMs: number = state.clockMs ?? timeline.durationMs;
  const visibleCount: number = LlmConversationReplay.visibleCount(timeline, clockMs);

  return {
    timeline: timeline,
    clockMs: clockMs,
    isPlaying: false,
    speed: 1,
    skipWaiting: true,
    visibleCount: visibleCount,
    currentIndex: visibleCount - 1,
    isAtEnd: clockMs >= timeline.durationMs,
    realTimeMs: T0,
    play: jest.fn(),
    pause: jest.fn(),
    togglePlay: jest.fn(),
    next: jest.fn(),
    previous: jest.fn(),
    restart: jest.fn(),
    goToEnd: jest.fn(),
    goToStep: jest.fn(),
    seekToProgress: jest.fn(),
    cycleSpeed: jest.fn(),
    setSkipWaiting: jest.fn(),
    ...state,
  } as Controller;
}

function renderBar(
  state: Partial<LlmConversationReplayController> = {},
  steps: ReadonlyArray<LlmTranscriptStep> = STEPS,
): Controller {
  const replay: Controller = controller(state, steps);

  render(<LlmReplayBar controller={replay} steps={steps} />);

  return replay;
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the play button", () => {
  test("at the end it offers to replay the conversation", () => {
    renderBar();

    const play: HTMLElement = screen.getByTestId("llm-replay-play");

    expect(play).toHaveTextContent("Replay");
    expect(play).toHaveAttribute("data-state", "paused");
    expect(play).toHaveAttribute("title", "Play or pause (K)");
  });

  test("part-way it plays; while playing it pauses", () => {
    renderBar({ clockMs: 1000 });

    expect(screen.getByTestId("llm-replay-play")).toHaveTextContent("Play");

    cleanup();

    renderBar({ clockMs: 1000, isPlaying: true });

    expect(screen.getByTestId("llm-replay-play")).toHaveTextContent("Pause");
    expect(screen.getByTestId("llm-replay-play")).toHaveAttribute("data-state", "playing");
  });

  test("toggles the replay", () => {
    const replay: Controller = renderBar();

    fireEvent.click(screen.getByTestId("llm-replay-play"));

    expect(replay.togglePlay).toHaveBeenCalledTimes(1);
  });

  test("with no messages there is nothing to play", () => {
    renderBar({}, []);

    expect(screen.getByTestId("llm-replay-play")).toBeDisabled();
  });
});

describe("moving through the messages", () => {
  test("back, forward, first and whole conversation, each pausing first", () => {
    const replay: Controller = renderBar({ clockMs: 2500 });

    fireEvent.click(screen.getByTestId("llm-replay-previous"));
    expect(replay.pause).toHaveBeenCalled();
    expect(replay.previous).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("llm-replay-next"));
    expect(replay.next).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("llm-replay-restart"));
    expect(replay.restart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("llm-replay-end"));
    expect(replay.goToEnd).toHaveBeenCalledTimes(1);
    expect(replay.pause).toHaveBeenCalledTimes(3);
  });

  test("at the start, nothing goes back", () => {
    renderBar({ clockMs: 0 });

    expect(screen.getByTestId("llm-replay-previous")).toBeDisabled();
    expect(screen.getByTestId("llm-replay-restart")).toBeDisabled();
    expect(screen.getByTestId("llm-replay-next")).not.toBeDisabled();
  });

  test("at the end, nothing goes forward", () => {
    renderBar();

    expect(screen.getByTestId("llm-replay-next")).toBeDisabled();
    expect(screen.getByTestId("llm-replay-end")).toBeDisabled();
    expect(screen.getByTestId("llm-replay-previous")).not.toBeDisabled();
  });

  test("the buttons say what they do, with their keys", () => {
    renderBar({ clockMs: 2500 });

    expect(screen.getByTestId("llm-replay-previous")).toHaveAttribute(
      "title",
      "Previous message (J)",
    );
    expect(screen.getByTestId("llm-replay-next")).toHaveAttribute("title", "Next message (L)");
    expect(screen.getByTestId("llm-replay-restart")).toHaveAttribute("title", "First message");
    expect(screen.getByTestId("llm-replay-end")).toHaveAttribute("title", "Whole conversation");
  });
});

describe("where the replay is", () => {
  test("the clock and the message count", () => {
    // Points 0, 2000, 3000, 6000; the replay ends at 6800.
    renderBar({ clockMs: 3000 });

    expect(screen.getByTestId("llm-replay-clock")).toHaveTextContent("0:03 / 0:06");
    expect(screen.getByTestId("llm-replay-position")).toHaveTextContent("Message 3 of 4");
  });

  test("at the end, the last message", () => {
    renderBar();

    expect(screen.getByTestId("llm-replay-position")).toHaveTextContent("Message 4 of 4");
  });

  test("the scrubber is a slider over the messages", () => {
    renderBar({ clockMs: 2000 });

    const scrubber: HTMLElement = screen.getByTestId("llm-replay-scrubber");

    expect(scrubber).toHaveAttribute("role", "slider");
    expect(scrubber).toHaveAttribute("aria-label", "Replay position");
    expect(scrubber).toHaveAttribute("aria-valuemin", "0");
    expect(scrubber).toHaveAttribute("aria-valuemax", "4");
    expect(scrubber).toHaveAttribute("aria-valuenow", "2");
    expect(scrubber).toHaveAttribute("aria-valuetext", "Message 2 of 4");
    expect(scrubber).toHaveAttribute("tabindex", "0");
  });

  test("with no messages the scrubber cannot be focused", () => {
    renderBar({}, []);

    expect(screen.getByTestId("llm-replay-scrubber")).toHaveAttribute("tabindex", "-1");
  });

  test("the progress fill follows the clock", () => {
    renderBar({ clockMs: 3400 });

    expect(screen.getByTestId("llm-replay-progress").style.width).toBe("50%");
  });
});

describe("the scrubber's dots", () => {
  test("one per message, coloured by who said it and what went wrong", () => {
    renderBar();

    expect(
      screen.getAllByTestId("llm-replay-marker").map((marker: HTMLElement): string | null => {
        return marker.getAttribute("data-tone");
      }),
    ).toEqual(["user", "answer", "tool", "problem"]);
  });

  test("the messages still to come are dimmed", () => {
    renderBar({ clockMs: 2000 });

    expect(
      screen.getAllByTestId("llm-replay-marker").map((marker: HTMLElement): boolean => {
        return marker.className.includes("opacity-40");
      }),
    ).toEqual([false, false, true, true]);
  });
});

describe("the scrubber's keys", () => {
  test.each([
    ["ArrowLeft", "previous"],
    ["ArrowDown", "previous"],
    ["ArrowRight", "next"],
    ["ArrowUp", "next"],
    ["Home", "restart"],
  ])("%s pauses and moves (%s)", (key: string, action: string) => {
    const replay: Controller = renderBar({ clockMs: 2500 });

    fireEvent.keyDown(screen.getByTestId("llm-replay-scrubber"), { key: key });

    expect(replay.pause).toHaveBeenCalled();
    expect(replay[action as "previous" | "next" | "restart"]).toHaveBeenCalledTimes(1);
  });

  test("End shows the whole conversation", () => {
    const replay: Controller = renderBar({ clockMs: 2500 });

    fireEvent.keyDown(screen.getByTestId("llm-replay-scrubber"), { key: "End" });

    expect(replay.goToEnd).toHaveBeenCalledTimes(1);
  });

  test("other keys are left alone", () => {
    const replay: Controller = renderBar({ clockMs: 2500 });

    fireEvent.keyDown(screen.getByTestId("llm-replay-scrubber"), { key: "k" });
    fireEvent.keyDown(screen.getByTestId("llm-replay-scrubber"), { key: " " });

    expect(replay.next).not.toHaveBeenCalled();
    expect(replay.previous).not.toHaveBeenCalled();
    expect(replay.pause).not.toHaveBeenCalled();
  });

  test("with no messages, no key does anything", () => {
    const replay: Controller = renderBar({}, []);

    fireEvent.keyDown(screen.getByTestId("llm-replay-scrubber"), { key: "ArrowRight" });

    expect(replay.next).not.toHaveBeenCalled();
  });
});

describe("dragging the scrubber", () => {
  /*
   * jsdom has no PointerEvent, so testing-library would dispatch a plain
   * Event without a clientX. A MouseEvent carries it, as a browser's
   * PointerEvent does.
   */
  beforeAll(() => {
    if (typeof window.PointerEvent === "undefined") {
      class TestPointerEvent extends MouseEvent {
        public pointerId: number;

        public constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 1;
        }
      }

      Object.defineProperty(window, "PointerEvent", {
        configurable: true,
        writable: true,
        value: TestPointerEvent,
      });
    }
  });

  function track(): HTMLElement {
    const scrubber: HTMLElement = screen.getByTestId("llm-replay-scrubber");

    jest.spyOn(scrubber, "getBoundingClientRect").mockReturnValue({
      left: 100,
      width: 200,
      right: 300,
      top: 0,
      bottom: 24,
      height: 24,
      x: 100,
      y: 0,
      toJSON: () => {
        return {};
      },
    } as DOMRect);

    return scrubber;
  }

  test("a press seeks to that point and pauses; a drag follows the pointer", () => {
    const replay: Controller = renderBar({ clockMs: 2500 });
    const scrubber: HTMLElement = track();

    fireEvent.pointerDown(scrubber, { clientX: 150, pointerId: 1 });

    expect(replay.pause).toHaveBeenCalled();
    expect(replay.seekToProgress).toHaveBeenLastCalledWith(0.25);

    fireEvent.pointerMove(scrubber, { clientX: 250, pointerId: 1 });

    expect(replay.seekToProgress).toHaveBeenLastCalledWith(0.75);

    fireEvent.pointerUp(scrubber, { clientX: 250, pointerId: 1 });
    fireEvent.pointerMove(scrubber, { clientX: 120, pointerId: 1 });

    expect(replay.seekToProgress).toHaveBeenCalledTimes(2);
  });

  test("moving over it without pressing does nothing", () => {
    const replay: Controller = renderBar({ clockMs: 2500 });

    fireEvent.pointerMove(track(), { clientX: 200, pointerId: 1 });

    expect(replay.seekToProgress).not.toHaveBeenCalled();
  });
});

describe("speed and skip waiting", () => {
  test("the speed reads as a multiple and cycles", () => {
    const replay: Controller = renderBar({ speed: 4 });

    expect(screen.getByTestId("llm-replay-speed")).toHaveTextContent("4x");

    fireEvent.click(screen.getByTestId("llm-replay-speed"));

    expect(replay.cycleSpeed).toHaveBeenCalledTimes(1);
  });

  test("skip waiting is a switch", () => {
    const replay: Controller = renderBar({ skipWaiting: true });
    const toggle: HTMLElement = screen.getByTestId("llm-replay-skip-waiting");

    expect(toggle).toHaveAttribute("role", "switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveTextContent("Skip waiting");

    fireEvent.click(toggle);

    expect(replay.setSkipWaiting).toHaveBeenCalledWith(false);
  });
});
