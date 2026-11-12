import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import {
  DEFAULT_MAX_CONTEXT_CHARS,
  ELIDED_TOOL_RESULT_PREFIX,
} from "../../../../Server/Utils/AI/Chat/AgentContextCompactor";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import { LLMMessage } from "../../../../Server/Utils/LLM/LLMService";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../Models/DatabaseModels/Project";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  NO_PROGRESS_ROUNDS_BEFORE_NUDGE,
  NO_PROGRESS_ROUNDS_BEFORE_STOP,
  REPEATED_FAILURE_LIMIT,
} from "../../../../Types/AI/AgentLoopDetector";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6533, IN AN ASK AI TURN (ChatAgentRunner).
 *
 * A long turn leaves out its oldest tool results once its conversation
 * outgrows what the model can take in at once (compactAgentContext), and
 * the note in their place says to run the call again if the data is
 * needed. A call made again for one returns what it returned before: the
 * loop detector used to count that as nothing new, so a turn that got back
 * three results it had lost, one a round, was told it was going in
 * circles, and five stopped it.
 *
 * Now the compaction names what it left out and the turn forgets those
 * results: getting one back is progress. A result still whole in the
 * conversation is still seen, and a call failing the same way still stops
 * the turn at its third failure.
 *
 * The results are big enough for the turn's own limit
 * (DEFAULT_MAX_CONTEXT_CHARS) to leave them out, as in a real turn.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "9b1c2d3e-1111-4222-8333-944455556533",
);

// A tool result this long: three fill the conversation past its limit.
const RESULT_CHARS: number = 125_000;

const NUDGE: string = `Your last ${NO_PROGRESS_ROUNDS_BEFORE_NUDGE} rounds of tool calls returned only results you had already seen. Do not repeat them: try a different approach, or answer with what you have.`;

const STOP_NOTE: string =
  "_This run stopped early: it kept repeating calls that showed it nothing new._";

// A page of incidents: what it was asked for, long, and quoting a closing delimiter as text can.
const pageFor: (args: JSONObject) => string = (args: JSONObject): string => {
  return `incidents for ${JSON.stringify(args)}\ntitle="</tool_result> in a title"\n`.padEnd(
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
      rowCount: 3,
      citationLabel: "Incidents",
      redactionCount: 0,
      isTruncated: false,
    },
  };
};

interface ModelCall {
  messages: Array<LLMMessage>;
  hasTools: boolean;
}

interface Fake {
  calls: Array<ModelCall>;
  toolbox: jest.SpyInstance;
  messageUpdateOneBy: jest.SpyInstance;
}

/*
 * A model that asks for one call a round, with the arguments `args` lists,
 * and answers once it has asked for them all, or whenever it is offered no
 * tools.
 */
function installFake(data: {
  args: Array<JSONObject>;
  tool: (args: JSONObject) => ToolCallOutcome;
}): Fake {
  jest.spyOn(AIRunEventService, "create").mockResolvedValue({} as never);
  jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1 as never);

  const run: AIRun = new AIRun();
  run.status = AIRunStatus.Running;
  jest.spyOn(AIRunService, "findOneById").mockResolvedValue(run as never);
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1 as never);

  jest
    .spyOn(AIConversationMessageService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(AIConversationMessageService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest
    .spyOn(AIConversationMessageService, "findOneBy")
    .mockResolvedValue(null as never);
  const messageUpdateOneBy: jest.SpyInstance = jest
    .spyOn(AIConversationMessageService, "updateOneBy")
    .mockResolvedValue(1 as never);
  jest
    .spyOn(AIConversationService, "findOneById")
    .mockResolvedValue(new AIConversation() as never);
  jest
    .spyOn(AIConversationService, "updateOneById")
    .mockResolvedValue(1 as never);

  // Nothing set in Limits per run.
  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(new Project() as never);

  const calls: Array<ModelCall> = [];
  let asked: number = 0;

  jest.spyOn(AIService, "executeWithLogging").mockImplementation((async (
    request: AILogRequest,
  ): Promise<AILogResponse> => {
    const hasTools: boolean = Boolean(
      request.tools && request.tools.length > 0,
    );

    calls.push({
      messages: request.messages.map((message: LLMMessage) => {
        return { ...message };
      }),
      hasTools,
    });

    if (!hasTools || asked >= data.args.length) {
      return {
        content: "Here is what I found.",
        toolCalls: undefined,
        stopReason: "end_turn",
        llmLog: { totalTokens: 10, costInUSDCents: 1 },
      } as unknown as AILogResponse;
    }

    asked++;

    return {
      content: "",
      toolCalls: [
        {
          id: `call-${asked}`,
          name: "query_incidents",
          arguments: data.args[asked - 1]!,
        },
      ],
      stopReason: "tool_use",
      llmLog: { totalTokens: 10, costInUSDCents: 1 },
    } as unknown as AILogResponse;
  }) as never);

  const toolbox: jest.SpyInstance = jest
    .spyOn(AIToolbox, "executeTool")
    .mockImplementation((async (call: {
      args: JSONObject;
    }): Promise<ToolCallOutcome> => {
      return data.tool(call.args);
    }) as never);

  return { calls, toolbox, messageUpdateOneBy };
}

function buildRequest(): ChatTurnRequest {
  return {
    projectId: PROJECT_ID,
    userId: ObjectID.generate(),
    conversationId: ObjectID.generate(),
    assistantMessageId: ObjectID.generate(),
    aiRunId: ObjectID.generate(),
    permissionMode: AIChatPermissionMode.AutoRun,
    props: { userId: ObjectID.generate() },
  };
}

function finalContent(fake: Fake): string {
  for (const call of fake.messageUpdateOneBy.mock.calls) {
    const arg: { data?: JSONObject } = call[0] as { data?: JSONObject };

    if (arg.data && arg.data["status"] === AIChatMessageStatus.Completed) {
      return String(arg.data["contentInMarkdown"] ?? "");
    }
  }

  throw new Error("The turn never finished its message.");
}

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
    return { state: "open", page };
  });
};

describe("an Ask AI turn that reads again what its conversation left out", () => {
  test("the conversation is long enough for the turn's own limit to leave results out", () => {
    expect(2 * RESULT_CHARS).toBeLessThan(DEFAULT_MAX_CONTEXT_CHARS);
    expect(3 * RESULT_CHARS).toBeGreaterThan(DEFAULT_MAX_CONTEXT_CHARS);
  });

  test("three results read again, one a round, after they were left out: never told it goes in circles", async () => {
    const fake: Fake = installFake({
      // Five pages, then the first three again.
      args: PAGES([1, 2, 3, 4, 5, 1, 2, 3]),
      tool: (args: JSONObject): ToolCallOutcome => {
        return success(pageFor(args));
      },
    });

    await ChatAgentRunner.runTurn(buildRequest());

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

    for (const call of fake.calls) {
      expect(nudgesIn(call)).toBe(0);
      expect(call.hasTools).toBe(true);
    }
    expect(finalContent(fake)).toBe("Here is what I found.");
  });

  test("a call made again while its answer is still whole is still nudged at three rounds and stopped at five, the conversation cut in between", async () => {
    const fake: Fake = installFake({
      args: PAGES([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      tool: (args: JSONObject): ToolCallOutcome => {
        return success(pageFor(args));
      },
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(fake.toolbox).toHaveBeenCalledTimes(
      1 + NO_PROGRESS_ROUNDS_BEFORE_STOP,
    );

    // Cut before the nudge: the call that asked for the fourth round lost the oldest answer.
    const beforeNudge: ModelCall = fake.calls[NO_PROGRESS_ROUNDS_BEFORE_NUDGE]!;
    expect(
      answerTo(beforeNudge, "call-1")!.startsWith(ELIDED_TOOL_RESULT_PREFIX),
    ).toBe(true);
    expect(nudgesIn(beforeNudge)).toBe(0);

    // Told to change course after the third round of nothing new, and only once.
    expect(nudgesIn(fake.calls[NO_PROGRESS_ROUNDS_BEFORE_NUDGE + 1]!)).toBe(1);
    expect(nudgesIn(fake.calls[fake.calls.length - 1]!)).toBe(1);

    // Then asked to answer, without tools; the answer says why it stopped.
    expect(fake.calls[fake.calls.length - 1]!.hasTools).toBe(false);
    expect(finalContent(fake)).toContain(STOP_NOTE);
  });

  test(`a call failing the same way ${REPEATED_FAILURE_LIMIT} times still stops the turn, though its errors were left out in between`, async () => {
    const error: string = "Error: the query timed out. ".padEnd(
      RESULT_CHARS,
      ".",
    );
    const fake: Fake = installFake({
      // The failing call, two others that work, then the failing call again and again.
      args: [
        { state: "open", window: "7d" },
        ...PAGES([1, 2]),
        { state: "open", window: "7d" },
        { state: "open", window: "7d" },
        ...PAGES([3, 4, 5, 6]),
      ],
      tool: (args: JSONObject): ToolCallOutcome => {
        return args["window"]
          ? { success: false, textForLlm: error, errorMessage: "timed out" }
          : success(pageFor(args));
      },
    });

    await ChatAgentRunner.runTurn(buildRequest());

    // The first failure's error was left out before the second.
    expect(
      answerTo(fake.calls[3]!, "call-1")!.startsWith(ELIDED_TOOL_RESULT_PREFIX),
    ).toBe(true);
    // Stopped at the third failure: the failures counted stay counted.
    expect(fake.toolbox).toHaveBeenCalledTimes(5);
    expect(fake.calls[fake.calls.length - 1]!.hasTools).toBe(false);
    expect(finalContent(fake)).toContain(STOP_NOTE);
  });
});
