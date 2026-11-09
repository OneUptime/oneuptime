import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import { LLMMessage } from "../../../../Server/Utils/LLM/LLMService";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../Models/DatabaseModels/Project";
import { PROJECT_AI_RUN_LIMITS_LOCATION } from "../../../../Types/AI/AIAgentRunLimits";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * An Ask AI turn (ChatAgentRunner) and its limits (issue #6440: "Why is
 * there a budget? Can we remove all of the artificial limits by default").
 *
 * A turn used to be cut off at 50 model calls and 100 tool calls (the
 * "runaway guard"). Now, with nothing set, it makes as many calls as its
 * question needs - these drive a fake model that needs 200 tool calls and
 * see it finish - and is held only to:
 *
 *   - the caps a project sets in Limits per run (model calls, tool calls,
 *     tokens), each of which makes the model answer with what it has, and
 *     the answer then says which limit and links to it;
 *   - its time limit, 120 minutes unless the project set its own;
 *   - loop detection: the same call failing again and again, or round after
 *     round of results already seen.
 *
 * No message the model is sent speaks of a budget.
 */

type SpyInstance = jest.SpyInstance;

const MINUTE_MS: number = 60 * 1000;
const PROJECT_ID: ObjectID = new ObjectID(
  "9b1c2d3e-1111-4222-8333-944455556666",
);

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const urlModule: { default: { fromString: (url: string) => unknown } } =
    jest.requireActual("../../../../Types/API/URL");

  return {
    ...actual,
    // The dashboard's address, so a stop note links to the setting.
    DashboardClientUrl: urlModule.default.fromString(
      "https://oneuptime.example.com/dashboard",
    ),
  };
});

const SETTINGS_LINK: string = `[${PROJECT_AI_RUN_LIMITS_LOCATION}](https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/settings/ai-features#LimitsPerRun)`;

afterEach(() => {
  jest.restoreAllMocks();
});

interface ToolCall {
  id: string;
  name: string;
  arguments: JSONObject;
}

function toolUse(calls: Array<ToolCall>, tokens: number = 10): AILogResponse {
  return {
    content: "",
    toolCalls: calls,
    stopReason: "tool_use",
    llmLog: { totalTokens: tokens, costInUSDCents: 1 },
  } as unknown as AILogResponse;
}

function answer(content: string, tokens: number = 10): AILogResponse {
  return {
    content,
    toolCalls: undefined,
    stopReason: "end_turn",
    llmLog: { totalTokens: tokens, costInUSDCents: 1 },
  } as unknown as AILogResponse;
}

function queryCall(index: number, args?: JSONObject): ToolCall {
  return {
    id: `call-${index}`,
    name: "query_incidents",
    arguments: args ?? { page: index },
  };
}

// The fake model: what it answers to its call number `index` (from 0).
type Script = (index: number) => AILogResponse | Promise<AILogResponse>;

interface Fake {
  // Every model call: what it was sent, copied when it was made.
  calls: Array<{ messages: Array<LLMMessage>; hasTools: boolean }>;
  messageUpdateOneBy: SpyInstance;
  toolboxExecute: SpyInstance;
}

function installFake(script: Script, project: Partial<Project> = {}): Fake {
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
  const messageUpdateOneBy: SpyInstance = jest
    .spyOn(AIConversationMessageService, "updateOneBy")
    .mockResolvedValue(1 as never);

  jest
    .spyOn(AIConversationService, "findOneById")
    .mockResolvedValue(new AIConversation() as never);
  jest
    .spyOn(AIConversationService, "updateOneById")
    .mockResolvedValue(1 as never);

  // The project's limits per run, as AIRunLimitsReader reads them.
  const row: Project = new Project();
  Object.assign(row, project);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(row as never);

  const calls: Fake["calls"] = [];

  jest
    .spyOn(AIService, "executeWithLogging")
    .mockImplementation(async (request: AILogRequest) => {
      /*
       * Copied now: the runner keeps adding to the array it sent, so the
       * call's own messages are only what it held at this moment.
       */
      calls.push({
        messages: request.messages.map((message: LLMMessage) => {
          return { ...message };
        }),
        hasTools: Boolean(request.tools && request.tools.length > 0),
      });

      return (await script(calls.length - 1)) as never;
    });

  // Each call's result names its own arguments, so different calls differ.
  const toolboxExecute: SpyInstance = jest
    .spyOn(AIToolbox, "executeTool")
    .mockImplementation(async (data: unknown) => {
      const args: unknown = (data as { toolCall?: { arguments?: unknown } })
        .toolCall?.arguments;
      const text: string = `incidents for ${JSON.stringify(args ?? {})}`;

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
      } as never;
    });

  return { calls, messageUpdateOneBy, toolboxExecute };
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

function lastUserMessage(fake: Fake, index: number): string {
  const found: LLMMessage | undefined = [...fake.calls[index]!.messages]
    .reverse()
    .find((message: LLMMessage) => {
      return message.role === "user";
    });

  return typeof found?.content === "string" ? found.content : "";
}

function toolResults(fake: Fake, index: number): Array<string> {
  return fake.calls[index]!.messages.filter((message: LLMMessage) => {
    return message.role === "tool";
  }).map((message: LLMMessage) => {
    return String(message.content);
  });
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

function everythingSent(fake: Fake): string {
  return JSON.stringify(
    fake.calls.map((call: { messages: Array<LLMMessage> }) => {
      return call.messages;
    }),
  );
}

describe("Ask AI with nothing set: no cap on calls", () => {
  test("a model that needs 200 tool calls, one a round, makes them all and answers", async () => {
    const fake: Fake = installFake((index: number) => {
      return index < 200 ? toolUse([queryCall(index)]) : answer("All 200 read.");
    });

    await ChatAgentRunner.runTurn(buildRequest());

    // Past the old 50 model calls and 100 tool calls.
    expect(fake.toolboxExecute).toHaveBeenCalledTimes(200);
    expect(fake.calls).toHaveLength(201);
    // Every call was offered tools: nothing told it to stop.
    expect(
      fake.calls.every((call: { hasTools: boolean }) => {
        return call.hasTools;
      }),
    ).toBe(true);
    expect(finalContent(fake)).toBe("All 200 read.");
    // No run budget: the only budget it hears of is an SLO error budget.
    expect(everythingSent(fake)).not.toMatch(/(?<!error )budget/i);
    expect(everythingSent(fake)).toContain("SLO error budget");
    expect(everythingSent(fake)).not.toContain("Answer now");
  }, 120_000);

  test("a batch of 250 tool calls in one response all run", async () => {
    const batch: Array<ToolCall> = Array.from(
      { length: 250 },
      (_: unknown, index: number) => {
        return queryCall(index);
      },
    );
    const fake: Fake = installFake((index: number) => {
      return index === 0 ? toolUse(batch) : answer("Read all of them.");
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(fake.toolboxExecute).toHaveBeenCalledTimes(250);
    expect(everythingSent(fake)).not.toContain("Skipped:");
    expect(finalContent(fake)).toBe("Read all of them.");
  }, 120_000);

  test("a turn that uses millions of tokens is never stopped for them", async () => {
    const fake: Fake = installFake((index: number) => {
      return index < 2
        ? toolUse([queryCall(index)], 900_000)
        : answer("Big context, still fine.", 900_000);
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[2]!.hasTools).toBe(true);
    expect(finalContent(fake)).toBe("Big context, still fine.");
  });
});

describe("Ask AI and the project's caps", () => {
  test("the tool-call cap: a batch stops at it, the skipped calls say why, and the model answers", async () => {
    const batch: Array<ToolCall> = Array.from(
      { length: 8 },
      (_: unknown, index: number) => {
        return queryCall(index);
      },
    );
    const fake: Fake = installFake(
      (index: number) => {
        return index === 0
          ? toolUse(batch)
          : answer("Here is what the five showed.");
      },
      { aiRunMaxToolCalls: 5 },
    );

    await ChatAgentRunner.runTurn(buildRequest());

    expect(fake.toolboxExecute).toHaveBeenCalledTimes(5);

    const skipped: Array<string> = toolResults(fake, 1).filter(
      (text: string) => {
        return text.startsWith("Skipped:");
      },
    );

    expect(skipped).toEqual([
      "Skipped: this run has made 5 tool calls, the most the project allows per run. Answer with the data you already have.",
      "Skipped: this run has made 5 tool calls, the most the project allows per run. Answer with the data you already have.",
      "Skipped: this run has made 5 tool calls, the most the project allows per run. Answer with the data you already have.",
    ]);

    // The model is told the limit it reached, and is offered no tools.
    expect(fake.calls[1]!.hasTools).toBe(false);
    expect(lastUserMessage(fake, 1)).toMatch(
      /^This run has made 5 tool calls, the most the project allows per run\. Answer now/,
    );

    expect(finalContent(fake)).toBe(
      `Here is what the five showed.\n\n_This run stopped at this project's limit of 5 tool calls per run. Change it in ${SETTINGS_LINK}._`,
    );
  });

  test("the model-call cap: the last call it allows is the answer", async () => {
    const fake: Fake = installFake(
      (index: number) => {
        return index < 2 ? toolUse([queryCall(index)]) : answer("Three calls in.");
      },
      { aiRunMaxModelCalls: 3 },
    );

    await ChatAgentRunner.runTurn(buildRequest());

    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[1]!.hasTools).toBe(true);
    expect(fake.calls[2]!.hasTools).toBe(false);
    expect(lastUserMessage(fake, 2)).toMatch(
      /^This is the last model call this run may make: the project allows 3 model calls per run\./,
    );
    expect(finalContent(fake)).toBe(
      `Three calls in.\n\n_This run stopped at this project's limit of 3 model calls per run. Change it in ${SETTINGS_LINK}._`,
    );
  });

  test("the token cap: when the next call would reach it, that call is the answer", async () => {
    const fake: Fake = installFake(
      (index: number) => {
        /*
         * 400 used: the next (at least 400 more) stays under 1,000. 800
         * used: the next would reach it, so it is the answer.
         */
        return index < 2
          ? toolUse([queryCall(index)], 400)
          : answer("Within the tokens.", 150);
      },
      { aiRunMaxTokens: 1_000 },
    );

    await ChatAgentRunner.runTurn(buildRequest());

    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[1]!.hasTools).toBe(true);
    expect(fake.calls[2]!.hasTools).toBe(false);
    expect(lastUserMessage(fake, 2)).toMatch(
      /^This run is about to reach the project's limit of 1,000 tokens per run\./,
    );
    expect(finalContent(fake)).toBe(
      `Within the tokens.\n\n_This run stopped at this project's limit of 1,000 tokens per run. Change it in ${SETTINGS_LINK}._`,
    );
  });

  test("the model-call cap holds while a cut-off answer is finished: the answer keeps what it has", async () => {
    const fake: Fake = installFake(
      (index: number) => {
        if (index === 0) {
          return toolUse([queryCall(0)]);
        }

        // Every answer is cut off by the model's output limit.
        return {
          content: ` [part ${index}]`,
          toolCalls: undefined,
          stopReason: "length",
          llmLog: { totalTokens: 10, costInUSDCents: 1 },
        } as unknown as AILogResponse;
      },
      { aiRunMaxModelCalls: 3 },
    );

    await ChatAgentRunner.runTurn(buildRequest());

    // The tool call, the answer, and one call going on with it - never a fourth.
    expect(fake.calls).toHaveLength(3);
    expect(finalContent(fake)).toBe(
      ` [part 1] [part 2]\n\n_[Answer truncated by the output token limit.]_\n\n_This run stopped at this project's limit of 3 model calls per run. Change it in ${SETTINGS_LINK}._`,
    );
  });

  test("with no cap, a cut-off answer is finished", async () => {
    const fake: Fake = installFake((index: number) => {
      return {
        content: index === 0 ? "The first half," : " and the rest.",
        toolCalls: undefined,
        stopReason: index === 0 ? "length" : "end_turn",
        llmLog: { totalTokens: 10, costInUSDCents: 1 },
      } as unknown as AILogResponse;
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(fake.calls).toHaveLength(2);
    expect(finalContent(fake)).toBe("The first half, and the rest.");
  });

  test("the token cap already reached: the turn stops without another call, and says so", async () => {
    const fake: Fake = installFake(
      () => {
        return toolUse([queryCall(1)], 1_500);
      },
      { aiRunMaxTokens: 1_000 },
    );

    await ChatAgentRunner.runTurn(buildRequest());

    expect(fake.calls).toHaveLength(1);
    // Never a blank answer: the note stands in for it.
    expect(finalContent(fake)).toBe(
      `_This run stopped at this project's limit of 1,000 tokens per run. Change it in ${SETTINGS_LINK}._`,
    );
  });
});

describe("Ask AI and the time limit", () => {
  test("hours inside the project's time limit keep the tools", async () => {
    let now: number = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      return now;
    });
    const fake: Fake = installFake(
      (index: number) => {
        // Each call takes an hour.
        now += 60 * MINUTE_MS;
        return index < 2 ? toolUse([queryCall(index)]) : answer("Done.");
      },
      { aiRunTimeLimitInMinutes: 600 },
    );

    await ChatAgentRunner.runTurn(buildRequest());

    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[2]!.hasTools).toBe(true);
    expect(finalContent(fake)).toBe("Done.");
  });

  test("past the default 120 minutes the model answers without tools, and the answer names the default", async () => {
    let now: number = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      return now;
    });
    const fake: Fake = installFake((index: number) => {
      if (index === 0) {
        // The first call took two hours and a minute.
        now += 121 * MINUTE_MS;
        return toolUse([queryCall(1)]);
      }

      return answer("What I found in time.");
    });

    await ChatAgentRunner.runTurn(buildRequest());

    // The tool asked for after the time was up was not run.
    expect(fake.toolboxExecute).not.toHaveBeenCalled();
    expect(toolResults(fake, 1)).toEqual([
      "Skipped: this run has reached its time limit of 120 minutes. Answer with the data you already have.",
    ]);
    expect(fake.calls[1]!.hasTools).toBe(false);
    expect(lastUserMessage(fake, 1)).toMatch(
      /^This run has reached its time limit of 120 minutes\. Answer now/,
    );
    expect(finalContent(fake)).toBe(
      `What I found in time.\n\n_This run stopped at the time limit of 120 minutes per run, the default. Change it in ${SETTINGS_LINK}._`,
    );
  });

  test("the project's own time limit, when it set one", async () => {
    let now: number = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      return now;
    });
    const fake: Fake = installFake(
      (index: number) => {
        if (index === 1) {
          now += 11 * MINUTE_MS;
        }

        return index < 2
          ? toolUse([queryCall(index)])
          : answer("Ten minutes of findings.");
      },
      { aiRunTimeLimitInMinutes: 10 },
    );

    await ChatAgentRunner.runTurn(buildRequest());

    expect(fake.toolboxExecute).toHaveBeenCalledTimes(1);
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[2]!.hasTools).toBe(false);
    expect(finalContent(fake)).toBe(
      `Ten minutes of findings.\n\n_This run stopped at this project's time limit of 10 minutes per run. Change it in ${SETTINGS_LINK}._`,
    );
  });
});

describe("Ask AI and loop detection", () => {
  test("the same call returning the same thing: nudged after three idle rounds, stopped after five, and the answer says why", async () => {
    const fake: Fake = installFake((index: number) => {
      // Always the same call, always the same result - until told to answer.
      return index < 50
        ? toolUse([queryCall(index, { status: "open" })])
        : answer("Unreachable.");
    });

    await ChatAgentRunner.runTurn(buildRequest());

    /*
     * Round 1 is new; rounds 2 to 6 show nothing new. The nudge comes after
     * round 4 (three idle rounds), the stop after round 6 (five), and the
     * seventh call is the answer, without tools - the model answered with
     * a tool call again, so its answer is empty and the note stands alone.
     */
    expect(fake.toolboxExecute).toHaveBeenCalledTimes(6);
    expect(fake.calls).toHaveLength(7);
    expect(lastUserMessage(fake, 4)).toBe(
      "Your last 3 rounds of tool calls returned only results you had already seen. Do not repeat them: try a different approach, or answer with what you have.",
    );
    expect(fake.calls[5]!.hasTools).toBe(true);
    expect(fake.calls[6]!.hasTools).toBe(false);
    expect(lastUserMessage(fake, 6)).toMatch(
      /^Your recent tool calls keep returning what you have already seen, so this run is going in circles\. Answer now/,
    );
    expect(finalContent(fake)).toContain(
      "_This run stopped early: it kept repeating calls that showed it nothing new._",
    );
    // Loop detection is not a setting: nothing to link to.
    expect(finalContent(fake)).not.toContain("](");
  });

  test("the same call failing the same way three times stops the turn", async () => {
    const fake: Fake = installFake((index: number) => {
      return index < 3
        ? toolUse([queryCall(index, { sevrity: "high" })])
        : answer("I could not query that.");
    });
    fake.toolboxExecute.mockResolvedValue({
      success: false,
      textForLlm: "Error: unknown field 'sevrity'.",
    } as never);

    await ChatAgentRunner.runTurn(buildRequest());

    expect(fake.toolboxExecute).toHaveBeenCalledTimes(3);
    expect(fake.calls).toHaveLength(4);
    expect(fake.calls[3]!.hasTools).toBe(false);
    expect(finalContent(fake)).toBe(
      "I could not query that.\n\n_This run stopped early: it kept repeating calls that showed it nothing new._",
    );
  });

  test("the same call returning something new each time is never a loop", async () => {
    const fake: Fake = installFake((index: number) => {
      return index < 30
        ? toolUse([queryCall(index, { status: "open" })])
        : answer("It kept changing.");
    });
    let served: number = 0;
    fake.toolboxExecute.mockImplementation(async () => {
      served++;
      return {
        success: true,
        textForLlm: `open incidents: ${served}`,
        result: {
          dataForLlm: `open incidents: ${served}`,
          rowCount: 1,
          citationLabel: "Incidents",
          redactionCount: 0,
          isTruncated: false,
        },
      } as never;
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(fake.toolboxExecute).toHaveBeenCalledTimes(30);
    expect(finalContent(fake)).toBe("It kept changing.");
    expect(everythingSent(fake)).not.toContain("rounds of tool calls");
  });
});
