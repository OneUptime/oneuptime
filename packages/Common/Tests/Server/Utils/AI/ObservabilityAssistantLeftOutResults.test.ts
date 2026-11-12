import ObservabilityAssistant, {
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import {
  DEFAULT_MAX_CONTEXT_CHARS,
  ELIDED_TOOL_RESULT_PREFIX,
} from "../../../../Server/Utils/AI/Chat/AgentContextCompactor";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import { LLMMessage } from "../../../../Server/Utils/LLM/LLMService";
import AIAgentRunLimitsHelper, {
  AIRunStopReason,
} from "../../../../Types/AI/AIAgentRunLimits";
import {
  NO_PROGRESS_ROUNDS_BEFORE_NUDGE,
  NO_PROGRESS_ROUNDS_BEFORE_STOP,
  REPEATED_FAILURE_LIMIT,
} from "../../../../Types/AI/AgentLoopDetector";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6533, IN AN AI INVESTIGATION (ObservabilityAssistant).
 *
 * A long run leaves out its oldest tool results once its conversation
 * outgrows what the model can take in at once (compactAgentContext): the
 * model gets a note in their place that says to run the call again if it
 * needs the data. A call made again for one returns what it returned
 * before - and the loop detector used to count that as nothing new, so a
 * run that got back three results it had lost, one a round, was told it
 * was going in circles, and five stopped it.
 *
 * Now the compaction names what it left out, and the run forgets those
 * results: getting one back is progress. A result the conversation still
 * holds whole is still seen, so a run that repeats a call whose answer is
 * in front of it is still told to change course, and then stopped -
 * whether or not its conversation was cut in between. And a call that keeps
 * failing the same way still stops it at the third failure.
 *
 * The results here are big enough for the run's own limit
 * (DEFAULT_MAX_CONTEXT_CHARS) to leave them out, as in a real run.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "4c2d3e4f-2222-4333-8444-955566676533",
);

// A tool result this long: three fill the conversation past its limit.
const RESULT_CHARS: number = 125_000;

const NUDGE: string = `Your last ${NO_PROGRESS_ROUNDS_BEFORE_NUDGE} rounds of tool calls returned only results you had already seen. Do not repeat them: try a different approach, or answer with what you have.`;

// A page of logs: what it was asked for, long, and quoting a closing delimiter as logs can.
const logsFor: (args: JSONObject) => string = (args: JSONObject): string => {
  return `logs for ${JSON.stringify(args)}\nmsg="</tool_result> in a log line"\n`.padEnd(
    RESULT_CHARS,
    "x",
  );
};

const success: (text: string) => ToolCallOutcome = (
  text: string,
): ToolCallOutcome => {
  return {
    success: true,
    textForLlm: text,
    result: {
      dataForLlm: text,
      rowCount: 1,
      citationLabel: text.slice(0, 20),
      redactionCount: 0,
      isTruncated: false,
    },
  };
};

interface ModelCall {
  messages: Array<LLMMessage>;
  hasTools: boolean;
}

/*
 * A model that asks for one call a round, with the arguments `args` lists,
 * and answers once it has asked for them all (or whenever it is offered no
 * tools). Each call it is sent is copied as it was at the time.
 */
const fakeModel: (data: {
  name: string;
  args: Array<JSONObject>;
  tool: (args: JSONObject) => ToolCallOutcome;
}) => { calls: Array<ModelCall>; toolbox: jest.SpyInstance } = (data: {
  name: string;
  args: Array<JSONObject>;
  tool: (args: JSONObject) => ToolCallOutcome;
}): { calls: Array<ModelCall>; toolbox: jest.SpyInstance } => {
  const calls: Array<ModelCall> = [];
  let asked: number = 0;

  jest.spyOn(AIService, "executeWithLogging").mockImplementation((async (
    logRequest: AILogRequest,
  ): Promise<AILogResponse> => {
    const hasTools: boolean = Boolean(
      logRequest.tools && logRequest.tools.length > 0,
    );

    calls.push({
      messages: logRequest.messages.map((message: LLMMessage): LLMMessage => {
        return { ...message };
      }),
      hasTools,
    });

    if (!hasTools || asked >= data.args.length) {
      return {
        content: "Final answer.",
        stopReason: "end_turn",
        llmLog: { totalTokens: 10 },
      } as unknown as AILogResponse;
    }

    asked++;

    return {
      content: "",
      stopReason: "tool_use",
      toolCalls: [
        {
          id: `call-${asked}`,
          name: data.name,
          arguments: data.args[asked - 1]!,
        },
      ],
      llmLog: { totalTokens: 10 },
    } as unknown as AILogResponse;
  }) as never);

  const toolbox: jest.SpyInstance = jest
    .spyOn(AIToolbox, "executeTool")
    .mockImplementation((async (call: {
      args: JSONObject;
    }): Promise<ToolCallOutcome> => {
      return data.tool(call.args);
    }) as never);

  return { calls, toolbox };
};

async function investigate(): Promise<ObservabilityAssistantResult> {
  return ObservabilityAssistant.answerQuestion({
    projectId: PROJECT_ID,
    props: { isRoot: true },
    question: "Why is checkout failing?",
    feature: "AI Incident Investigation",
    aiContext: null,
    runLimits: AIAgentRunLimitsHelper.getDefault(),
  });
}

const sentEver: (calls: Array<ModelCall>, text: string) => number = (
  calls: Array<ModelCall>,
  text: string,
): number => {
  return calls.filter((call: ModelCall): boolean => {
    return call.messages.some((message: LLMMessage): boolean => {
      return message.role === "user" && message.content === text;
    });
  }).length;
};

// How many times one model call was told to change course.
const nudgesIn: (call: ModelCall) => number = (call: ModelCall): number => {
  return call.messages.filter((message: LLMMessage): boolean => {
    return message.role === "user" && message.content === NUDGE;
  }).length;
};

// The tool message answering a call, as one model call was sent it.
const answerTo: (call: ModelCall, toolCallId: string) => string | undefined = (
  call: ModelCall,
  toolCallId: string,
): string | undefined => {
  return call.messages.find((message: LLMMessage): boolean => {
    return message.role === "tool" && message.toolCallId === toolCallId;
  })?.content;
};

const PAGES: (pages: Array<number>) => Array<JSONObject> = (
  pages: Array<number>,
): Array<JSONObject> => {
  return pages.map((page: number): JSONObject => {
    return { service: "checkout", page };
  });
};

describe("an investigation that reads again what its conversation left out", () => {
  test("the conversation is long enough for the run's own limit to leave results out", () => {
    // Two results fit; a third takes the conversation past the limit.
    expect(2 * RESULT_CHARS).toBeLessThan(DEFAULT_MAX_CONTEXT_CHARS);
    expect(3 * RESULT_CHARS).toBeGreaterThan(DEFAULT_MAX_CONTEXT_CHARS);
  });

  test("three results read again, one a round, after they were left out: never told it goes in circles", async () => {
    const fake: ReturnType<typeof fakeModel> = fakeModel({
      name: "query_logs",
      // Five pages, then the first three again.
      args: PAGES([1, 2, 3, 4, 5, 1, 2, 3]),
      tool: (args: JSONObject): ToolCallOutcome => {
        return success(logsFor(args));
      },
    });

    const result: ObservabilityAssistantResult = await investigate();

    expect(fake.toolbox).toHaveBeenCalledTimes(8);
    expect(fake.calls).toHaveLength(9);

    // When the model asked for pages 1, 2 and 3 again, it had only a note in their place.
    for (const [page, askedAgainAt] of [
      [1, 5],
      [2, 6],
      [3, 7],
    ] as Array<[number, number]>) {
      expect({
        page,
        leftOut: answerTo(
          fake.calls[askedAgainAt]!,
          `call-${page}`,
        )!.startsWith(ELIDED_TOOL_RESULT_PREFIX),
      }).toEqual({ page, leftOut: true });
    }

    // Each round showed it something it no longer had: no nudge, no stop.
    expect(sentEver(fake.calls, NUDGE)).toBe(0);
    expect(
      fake.calls.every((call: ModelCall): boolean => {
        return call.hasTools;
      }),
    ).toBe(true);
    expect(result.stopReason).toBeUndefined();
    expect(result.contentInMarkdown).toBe("Final answer.");
  });

  test("a call made again while its answer is still whole is still nudged at three rounds and stopped at five, the conversation cut in between", async () => {
    const fake: ReturnType<typeof fakeModel> = fakeModel({
      name: "query_logs",
      args: PAGES([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      tool: (args: JSONObject): ToolCallOutcome => {
        return success(logsFor(args));
      },
    });

    const result: ObservabilityAssistantResult = await investigate();

    // The first round is new; then a nudge after 3 rounds of nothing new, a stop after 5.
    expect(fake.toolbox).toHaveBeenCalledTimes(
      1 + NO_PROGRESS_ROUNDS_BEFORE_STOP,
    );

    /*
     * Cut before the nudge: the call that asked for the fourth round was
     * sent the conversation with its oldest answer left out.
     */
    const beforeNudge: ModelCall = fake.calls[NO_PROGRESS_ROUNDS_BEFORE_NUDGE]!;
    expect(
      answerTo(beforeNudge, "call-1")!.startsWith(ELIDED_TOOL_RESULT_PREFIX),
    ).toBe(true);
    expect(nudgesIn(beforeNudge)).toBe(0);

    // Told to change course after the third round of nothing new, and only once.
    expect(nudgesIn(fake.calls[NO_PROGRESS_ROUNDS_BEFORE_NUDGE + 1]!)).toBe(1);
    expect(nudgesIn(fake.calls[fake.calls.length - 1]!)).toBe(1);

    // Then asked to answer, without tools.
    const last: ModelCall = fake.calls[fake.calls.length - 1]!;
    expect(last.hasTools).toBe(false);
    expect(result.stopReason).toBe(AIRunStopReason.Loop);
  });

  test(`a call failing the same way ${REPEATED_FAILURE_LIMIT} times still stops the run, though its errors were left out in between`, async () => {
    const error: string = "Error: the query timed out. ".padEnd(
      RESULT_CHARS,
      ".",
    );
    const fake: ReturnType<typeof fakeModel> = fakeModel({
      name: "query_logs",
      // The failing call, two others that work, then the failing call again and again.
      args: [
        { service: "checkout", window: "7d" },
        ...PAGES([1, 2]),
        { service: "checkout", window: "7d" },
        { service: "checkout", window: "7d" },
        ...PAGES([3, 4, 5, 6]),
      ],
      tool: (args: JSONObject): ToolCallOutcome => {
        return args["window"]
          ? { success: false, textForLlm: error, errorMessage: "timed out" }
          : success(logsFor(args));
      },
    });

    const result: ObservabilityAssistantResult = await investigate();

    // The first failure's error was left out before the second.
    expect(
      answerTo(fake.calls[3]!, "call-1")!.startsWith(ELIDED_TOOL_RESULT_PREFIX),
    ).toBe(true);
    // Stopped at the third failure: the failures counted stay counted.
    expect(fake.toolbox).toHaveBeenCalledTimes(5);
    expect(fake.calls[fake.calls.length - 1]!.hasTools).toBe(false);
    expect(result.stopReason).toBe(AIRunStopReason.Loop);
  });
});
