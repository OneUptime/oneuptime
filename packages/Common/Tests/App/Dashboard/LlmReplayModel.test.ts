import { describe, expect, test } from "@jest/globals";
import {
  LLM_REPLAY_MARKER_CLASS_NAMES,
  LlmReplayMarker,
  buildLlmReplayMarkers,
  getLlmPendingAnswer,
  getLlmReplayMarkerTone,
  readLlmStepParam,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmReplayModel";
import {
  LlmTranscriptStep,
  LlmTranscriptStepType,
} from "../../../Utils/Telemetry/LlmConversationTranscript";
import { LlmReplayTimeline } from "../../../Utils/Telemetry/LlmConversationReplay";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import { LlmCallKind } from "../../../Types/Telemetry/LlmCallKind";

/*
 * What the conversation replay draws besides the messages: a dot on the
 * scrubber per message, coloured by who said it and whether it went wrong,
 * and the "AI is answering…" bubble that holds the place of an answer still
 * on its way. The bubble is the replay's whole point - it shows the wait the
 * person sat through - so when it shows, and for what, is pinned here.
 */

const T0: number = Date.UTC(2026, 9, 10, 9, 0, 0);

let stepCounter: number = 0;

function makeStep(
  type: LlmTranscriptStepType,
  data: {
    atMs?: number;
    startMs?: number;
    issues?: Array<string>;
    fromHistory?: boolean;
    model?: string;
    kind?: LlmCallKind;
  } = {},
): LlmTranscriptStep {
  stepCounter++;
  const startMs: number = data.startMs ?? T0;
  const atMs: number = data.atMs ?? T0 + 1000;

  return {
    id: `span-${stepCounter}:0`,
    type: type,
    atMs: atMs,
    call: {
      spanId: `span-${stepCounter}`,
      traceId: "0123456789abcdef0123456789abcdef",
      kind: data.kind ?? LlmCallKind.Answer,
      name: "chat gpt-4o",
      model: data.model ?? "gpt-4o",
      provider: "openai",
      agentName: "",
      startMs: startMs,
      endMs: atMs,
      durationMs: atMs - startMs,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
      finishReasons: [],
      issues: (data.issues ?? []) as Array<LlmAnswerIssue>,
      evaluations: [],
      errorMessage: "",
    },
    text: "text",
    reasoning: "",
    media: [],
    toolCallId: "",
    toolName: "",
    toolArguments: "",
    fromHistory: data.fromHistory ?? false,
  };
}

function timeline(
  points: Array<number>,
  durationMs: number,
): LlmReplayTimeline {
  return {
    points: points,
    realTimes: points.map((point: number): number => {
      return T0 + point;
    }),
    durationMs: durationMs,
    realDurationMs: durationMs,
    hasSkippedGaps: false,
  };
}

describe("getLlmReplayMarkerTone", () => {
  test("the person's messages are indigo, tools cyan, quiet activity grey", () => {
    expect(
      getLlmReplayMarkerTone(makeStep(LlmTranscriptStepType.UserMessage)),
    ).toBe("user");
    expect(
      getLlmReplayMarkerTone(makeStep(LlmTranscriptStepType.ToolCall)),
    ).toBe("tool");
    expect(
      getLlmReplayMarkerTone(makeStep(LlmTranscriptStepType.ToolResult)),
    ).toBe("tool");
    expect(
      getLlmReplayMarkerTone(makeStep(LlmTranscriptStepType.Activity)),
    ).toBe("activity");
    expect(
      getLlmReplayMarkerTone(makeStep(LlmTranscriptStepType.Instructions)),
    ).toBe("activity");
  });

  test("a failed call is always a problem", () => {
    expect(
      getLlmReplayMarkerTone(makeStep(LlmTranscriptStepType.Failure)),
    ).toBe("problem");
  });

  test("an answer is violet unless something went wrong with it", () => {
    expect(
      getLlmReplayMarkerTone(makeStep(LlmTranscriptStepType.AssistantMessage)),
    ).toBe("answer");
    expect(
      getLlmReplayMarkerTone(
        makeStep(LlmTranscriptStepType.AssistantMessage, {
          issues: [LlmAnswerIssue.Refused],
        }),
      ),
    ).toBe("problem");
    expect(
      getLlmReplayMarkerTone(
        makeStep(LlmTranscriptStepType.SilentAnswer, {
          issues: [LlmAnswerIssue.Failed],
        }),
      ),
    ).toBe("problem");
  });

  test("an answer seen only in a later prompt's history is never marked a problem", () => {
    /*
     * A history answer carries no call of its own: the issues it would show
     * belong to the later call that carried it.
     */
    expect(
      getLlmReplayMarkerTone(
        makeStep(LlmTranscriptStepType.AssistantMessage, {
          issues: [LlmAnswerIssue.CutOff],
          fromHistory: true,
        }),
      ),
    ).toBe("answer");
  });

  test("an issue value the Dashboard does not know is not a problem", () => {
    expect(
      getLlmReplayMarkerTone(
        makeStep(LlmTranscriptStepType.AssistantMessage, {
          issues: ["slow", "toxic"],
        }),
      ),
    ).toBe("answer");
  });

  test("every tone has a colour", () => {
    for (const tone of ["user", "answer", "tool", "activity", "problem"]) {
      expect(
        LLM_REPLAY_MARKER_CLASS_NAMES[
          tone as keyof typeof LLM_REPLAY_MARKER_CLASS_NAMES
        ],
      ).toMatch(/^bg-[a-z]+-\d{3}$/);
    }
  });
});

describe("buildLlmReplayMarkers", () => {
  test("one marker per step, placed at its share of the replay", () => {
    const steps: Array<LlmTranscriptStep> = [
      makeStep(LlmTranscriptStepType.UserMessage),
      makeStep(LlmTranscriptStepType.AssistantMessage),
      makeStep(LlmTranscriptStepType.ToolCall),
      makeStep(LlmTranscriptStepType.Failure),
    ];

    const markers: Array<LlmReplayMarker> = buildLlmReplayMarkers(
      steps,
      timeline([0, 250, 500, 1000], 1000),
    );

    expect(markers).toEqual([
      { index: 0, position: 0, tone: "user" },
      { index: 1, position: 0.25, tone: "answer" },
      { index: 2, position: 0.5, tone: "tool" },
      { index: 3, position: 1, tone: "problem" },
    ]);
  });

  test("positions stay on the track", () => {
    const steps: Array<LlmTranscriptStep> = [
      makeStep(LlmTranscriptStepType.UserMessage),
      makeStep(LlmTranscriptStepType.AssistantMessage),
    ];

    expect(
      buildLlmReplayMarkers(steps, timeline([-50, 1500], 1000)).map(
        (marker: LlmReplayMarker): number => {
          return marker.position;
        },
      ),
    ).toEqual([0, 1]);
  });

  test("a step the timeline has no point for sits at the start", () => {
    const steps: Array<LlmTranscriptStep> = [
      makeStep(LlmTranscriptStepType.UserMessage),
      makeStep(LlmTranscriptStepType.AssistantMessage),
    ];

    expect(
      buildLlmReplayMarkers(steps, timeline([400], 1000))[1]?.position,
    ).toBe(0);
  });

  test("a replay with no length has no markers to place", () => {
    expect(
      buildLlmReplayMarkers(
        [makeStep(LlmTranscriptStepType.UserMessage)],
        timeline([0], 0),
      ),
    ).toEqual([]);
  });

  test("a dense burst of tool calls keeps every marker", () => {
    const steps: Array<LlmTranscriptStep> = Array.from(
      { length: 50 },
      (): LlmTranscriptStep => {
        return makeStep(LlmTranscriptStepType.ToolCall);
      },
    );

    expect(
      buildLlmReplayMarkers(
        steps,
        timeline(
          steps.map((_step: LlmTranscriptStep, index: number): number => {
            return 500 + index;
          }),
          10_000,
        ),
      ),
    ).toHaveLength(50);
  });
});

describe("getLlmPendingAnswer", () => {
  const question: LlmTranscriptStep = makeStep(
    LlmTranscriptStepType.UserMessage,
    {
      startMs: T0,
      atMs: T0,
    },
  );

  function answerAfterQuestion(
    type: LlmTranscriptStepType,
    data: { fromHistory?: boolean } = {},
  ): Array<LlmTranscriptStep> {
    return [
      question,
      makeStep(type, {
        startMs: T0 + 100,
        atMs: T0 + 3100,
        model: "claude-sonnet-4",
        ...(data.fromHistory === undefined
          ? {}
          : { fromHistory: data.fromHistory }),
      }),
    ];
  }

  test("between a question and its answer, the AI is answering", () => {
    expect(
      getLlmPendingAnswer(
        answerAfterQuestion(LlmTranscriptStepType.AssistantMessage),
        1,
        T0 + 1600,
      ),
    ).toEqual({ elapsedMs: 1500, isTool: false, model: "claude-sonnet-4" });
  });

  test("the wait counts up from the moment the call started", () => {
    const steps: Array<LlmTranscriptStep> = answerAfterQuestion(
      LlmTranscriptStepType.AssistantMessage,
    );

    expect(getLlmPendingAnswer(steps, 1, T0 + 100)?.elapsedMs).toBe(0);
    expect(getLlmPendingAnswer(steps, 1, T0 + 3099)?.elapsedMs).toBe(2999);
  });

  test("before the call started, or once the answer arrived, nothing is pending", () => {
    const steps: Array<LlmTranscriptStep> = answerAfterQuestion(
      LlmTranscriptStepType.AssistantMessage,
    );

    expect(getLlmPendingAnswer(steps, 1, T0 + 50)).toBeNull();
    expect(getLlmPendingAnswer(steps, 1, T0 + 3100)).toBeNull();
    expect(getLlmPendingAnswer(steps, 1, T0 + 9000)).toBeNull();
  });

  test("a tool's result on its way reads as the tool running", () => {
    expect(
      getLlmPendingAnswer(
        answerAfterQuestion(LlmTranscriptStepType.ToolResult),
        1,
        T0 + 600,
      )?.isTool,
    ).toBe(true);
  });

  test("a tool request, a failure and an unrecorded answer are the AI at work too", () => {
    for (const type of [
      LlmTranscriptStepType.ToolCall,
      LlmTranscriptStepType.Failure,
      LlmTranscriptStepType.SilentAnswer,
    ]) {
      expect({
        type,
        pending: getLlmPendingAnswer(answerAfterQuestion(type), 1, T0 + 600),
      }).toEqual({
        type,
        pending: { elapsedMs: 500, isTool: false, model: "claude-sonnet-4" },
      });
    }
  });

  test("the person's next message, an activity or instructions are not awaited", () => {
    for (const type of [
      LlmTranscriptStepType.UserMessage,
      LlmTranscriptStepType.Activity,
      LlmTranscriptStepType.Instructions,
    ]) {
      expect(
        getLlmPendingAnswer(answerAfterQuestion(type), 1, T0 + 600),
      ).toBeNull();
    }
  });

  test("an answer known only from history was never waited for", () => {
    for (const type of [
      LlmTranscriptStepType.AssistantMessage,
      LlmTranscriptStepType.ToolCall,
    ]) {
      expect(
        getLlmPendingAnswer(
          answerAfterQuestion(type, { fromHistory: true }),
          1,
          T0 + 600,
        ),
      ).toBeNull();
    }
  });

  test("nothing is pending before the first message or after the last", () => {
    const steps: Array<LlmTranscriptStep> = answerAfterQuestion(
      LlmTranscriptStepType.AssistantMessage,
    );

    expect(getLlmPendingAnswer(steps, 0, T0 + 600)).toBeNull();
    expect(getLlmPendingAnswer(steps, 2, T0 + 600)).toBeNull();
    expect(getLlmPendingAnswer(steps, 7, T0 + 600)).toBeNull();
    expect(getLlmPendingAnswer([], 0, T0)).toBeNull();
  });

  test("a call with no start time is never shown as pending", () => {
    const steps: Array<LlmTranscriptStep> = [
      question,
      makeStep(LlmTranscriptStepType.AssistantMessage, {
        startMs: 0,
        atMs: T0 + 3000,
      }),
    ];

    expect(getLlmPendingAnswer(steps, 1, T0 + 600)).toBeNull();
  });
});

describe("readLlmStepParam", () => {
  test.each([
    ["0", 5, 0],
    ["2", 5, 2],
    ["4", 5, 4],
    [" 3 ", 5, 3],
  ])(
    "?step=%p of %p steps is step %p",
    (value: string, count: number, expected: number) => {
      expect(readLlmStepParam(value, count)).toBe(expected);
    },
  );

  test.each([
    [null, 5],
    ["", 5],
    ["   ", 5],
    ["5", 5],
    ["-1", 5],
    ["1.5", 5],
    ["abc", 5],
    ["2", 0],
    ["Infinity", 5],
  ])(
    "?step=%p of %p steps names no step",
    (value: string | null, count: number) => {
      expect(readLlmStepParam(value, count)).toBeNull();
    },
  );
});
