/*
 * ---------------------------------------------------------------------------
 * The in-house code agent and the RUN'S OWN LIMITS (issue #6440: "Why is
 * there a budget? Can we remove all of the artificial limits by default,
 * customers can add them if they need it").
 *
 * The agent used to stop at 40 calls of its own, wind down on the server's
 * call and output-token budget, and give production telemetry 12 calls. It
 * has none of those now. What a current server tells it with every answer
 * (`limits`, Types/AI/CodeAgentRunLimits) is all that holds a run:
 *
 *   - NOTHING BY DEFAULT but the run's time limit and loop detection: a
 *     model that needs 200 tool calls makes them, and is never told of a
 *     budget it does not have.
 *   - THE PROJECT'S CAPS, when it sets them (Project Settings → AI → AI
 *     Features → More settings → Limits per run): model calls, tool calls,
 *     tokens per run. Before each, the agent winds down - its last call is
 *     made without tools, its answer is the summary - and the summary ends
 *     with a sentence that names the setting.
 *   - THE TIME LIMIT, kept to the time the server says is left (so a Runner
 *     whose clock is off still keeps it), and a step's own time (a build
 *     repair pass) when that comes first.
 *   - LOOP DETECTION: the same failing call again and again, or rounds that
 *     show nothing new - nudged, then stopped.
 *
 * InHouseCodeAgentLoop.test.ts keeps the agent's wind-down on the budget of
 * a server from before #6440.
 * ---------------------------------------------------------------------------
 */

import InHouseCodeAgent from "../../CodeAgents/InHouseCodeAgent";
import { CodeAgentResult } from "../../CodeAgents/CodeAgentInterface";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "Common/Server/Utils/LLM/LLMService";
import { CodeAgentRunLimits } from "Common/Types/AI/CodeAgentRunLimits";
import { AIRunTimeLimitSource } from "Common/Types/AI/AIAgentRunLimits";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const llmCompletionMock: jest.Mock = jest.fn();
const getTelemetryToolsMock: jest.Mock = jest.fn();
const runTelemetryToolMock: jest.Mock = jest.fn();

jest.mock("../../Utils/BackendAPI", () => {
  return {
    __esModule: true,
    default: class {
      /*
       * The agent sends one conversation it keeps adding to: each request
       * is recorded as it was sent.
       */
      public async llmCompletion(request: {
        messages: Array<unknown>;
      }): Promise<unknown> {
        return llmCompletionMock({
          ...request,
          messages: [...request.messages],
        });
      }

      public async getTelemetryTools(
        ...args: Array<unknown>
      ): Promise<unknown> {
        return getTelemetryToolsMock(...args);
      }

      public async runTelemetryTool(...args: Array<unknown>): Promise<unknown> {
        return runTelemetryToolMock(...args);
      }
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.setTimeout(180000);

const LIMITS_LOCATION: string =
  "Project Settings → AI → AI Features → More settings → Limits per run";

const ANSWER_NOW: string =
  "Do not request any more tools. Reply now with a plain-text summary of the changes you made and anything left undone.";

interface CompletionRequest {
  taskId: string;
  messages: Array<LLMMessage>;
  tools?: Array<LLMToolDefinition>;
}

/*
 * What a current server says of a run: no caps, the default time limit with
 * most of it left, and the usage given.
 */
function runLimits(
  overrides: Partial<CodeAgentRunLimits> = {},
): CodeAgentRunLimits {
  return {
    maxModelCalls: null,
    maxToolCalls: null,
    maxTokens: null,
    timeLimitInMinutes: 120,
    timeLimitSource: AIRunTimeLimitSource.Default,
    deadlineAt: new Date(Date.now() + 110 * 60 * 1000).toISOString(),
    timeLeftMs: 110 * 60 * 1000,
    modelCallsUsed: 1,
    toolCallsUsed: 0,
    tokensUsed: 1000,
    lastCallTokens: 1000,
    ...overrides,
  };
}

/*
 * A fake server: counts the run's model calls and tokens as the real one
 * does, and answers each completion with the run's limits after it.
 */
class FakeServer {
  public modelCalls: number = 0;
  public tokens: number = 0;

  public constructor(
    private readonly caps: Partial<CodeAgentRunLimits> = {},
    private readonly tokensPerCall: number = 1000,
  ) {}

  public answer(data: {
    content?: string;
    toolCalls?: Array<LLMToolCall>;
    limits?: Partial<CodeAgentRunLimits>;
  }): unknown {
    this.modelCalls++;
    this.tokens += this.tokensPerCall;

    const toolCalls: Array<LLMToolCall> = data.toolCalls || [];

    return {
      content: data.content ?? "",
      toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
      limits: runLimits({
        ...this.caps,
        modelCallsUsed: this.modelCalls,
        tokensUsed: this.tokens,
        lastCallTokens: this.tokensPerCall,
        ...(data.limits || {}),
      }),
      // What a Runner from before #6440 would read; this one must not.
      budget: {
        completionCallsUsed: this.modelCalls,
        maxCompletionCalls: 40,
        outputTokensUsed: 100,
        maxOutputTokens: 100_000,
      },
    };
  }
}

const temporaryPaths: Array<string> = [];

function makeWorkspace(): string {
  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-agent-limits-"),
  );
  temporaryPaths.push(dir);

  const run: (args: Array<string>) => void = (args: Array<string>): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };

  run(["init", "-q", "-b", "main", "."]);
  run(["config", "user.email", "tests@oneuptime.com"]);
  run(["config", "user.name", "Runner Tests"]);
  run(["config", "commit.gpgsign", "false"]);

  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "cart.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# cart\n");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "baseline"]);

  return dir;
}

function toolCall(
  name: string,
  args: Record<string, unknown>,
  id: string = `call-${name}`,
): LLMToolCall {
  return { id, name, arguments: args } as unknown as LLMToolCall;
}

// A call that shows the run something new each time: a search for a new term.
function newSearch(index: number): LLMToolCall {
  return toolCall(
    "search_files",
    { pattern: `marker-${index}` },
    `search-${index}`,
  );
}

async function runAgent(
  workspace: string,
  options?: { timeoutMs?: number; productionTelemetry?: boolean },
): Promise<CodeAgentResult> {
  const agent: InHouseCodeAgent = new InHouseCodeAgent();
  await agent.initialize({ taskId: "run-1" });

  const result: CodeAgentResult = await agent.executeTask({
    workingDirectory: workspace,
    prompt: "Fix the checkout bug.",
    ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.productionTelemetry ? { productionTelemetry: true } : {}),
  });

  await agent.cleanup();

  return result;
}

function requests(): Array<CompletionRequest> {
  return llmCompletionMock.mock.calls.map((call: Array<unknown>) => {
    return call[0] as CompletionRequest;
  });
}

function offeredTools(request: CompletionRequest | undefined): boolean {
  return request?.tools !== undefined;
}

function lastMessage(request: CompletionRequest | undefined): LLMMessage {
  return (request?.messages || []).slice(-1)[0] as LLMMessage;
}

function toolMessages(request: CompletionRequest): Array<LLMMessage> {
  return request.messages.filter((message: LLMMessage): boolean => {
    return message.role === "tool";
  });
}

function everyMessageText(): string {
  return requests()
    .map((request: CompletionRequest): string => {
      return request.messages
        .map((message: LLMMessage): string => {
          return message.content || "";
        })
        .join("\n");
    })
    .join("\n");
}

function telemetryTool(name: string): LLMToolDefinition {
  return {
    name,
    description: `Reads production (${name}).`,
    inputSchema: { type: "object", properties: {} },
  };
}

function telemetryOffer(limits: CodeAgentRunLimits): unknown {
  return {
    tools: [telemetryTool("query_traces")],
    repository: "acme/cart",
    services: [
      {
        id: "8b1c2d3e-3333-4222-8333-944455556666",
        name: "cart-api",
        pathInRepository: "services/cart",
      },
    ],
    reason: null,
    limits,
    budget: {
      completionCallsUsed: 0,
      maxCompletionCalls: 40,
      outputTokensUsed: 0,
      maxOutputTokens: 100_000,
      toolCallsUsed: limits.toolCallsUsed,
      maxToolCalls: 12,
    },
  };
}

beforeEach(() => {
  llmCompletionMock.mockReset();
  getTelemetryToolsMock.mockReset();
  runTelemetryToolMock.mockReset();
});

afterAll(() => {
  for (const target of temporaryPaths) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("no limit set: the task works as long as its work needs", () => {
  /*
   * THE CUSTOMER'S CASE. A run used to stop at 40 calls (the agent's own
   * mirror of the server's budget) and was told "The tool budget for this
   * run is exhausted". With nothing set, a model that needs 200 tool calls
   * makes every one of them and answers when it is done.
   */
  test("a model that needs 200 tool calls makes them all and finishes, far past the 40 a run used to stop at", async () => {
    const server: FakeServer = new FakeServer();
    let calls: number = 0;

    llmCompletionMock.mockImplementation(async () => {
      if (calls < 200) {
        calls++;
        return server.answer({ toolCalls: [newSearch(calls)] });
      }

      return server.answer({ content: "Fixed it after 200 searches." });
    });

    const result: CodeAgentResult = await runAgent(makeWorkspace());

    expect(result.success).toBe(true);
    expect(requests()).toHaveLength(201);
    // Every call offered the tools: nothing withheld them, nothing wound down.
    expect(
      requests().every((request: CompletionRequest): boolean => {
        return offeredTools(request);
      }),
    ).toBe(true);
    expect(toolMessages(requests()[200]!)).toHaveLength(200);
    // No sentence under the summary: no limit stopped it.
    expect(result.summary).toBe("Fixed it after 200 searches.");
    expect(everyMessageText()).not.toContain("Reply now");
  });

  test("the model is never told of a budget, nor of a count of calls it does not have", async () => {
    const server: FakeServer = new FakeServer();
    getTelemetryToolsMock.mockResolvedValue(
      telemetryOffer(runLimits({ modelCallsUsed: 0, tokensUsed: 0 })),
    );
    llmCompletionMock
      .mockImplementationOnce(async () => {
        return server.answer({ toolCalls: [newSearch(1)] });
      })
      .mockImplementation(async () => {
        return server.answer({ content: "Done." });
      });

    await runAgent(makeWorkspace(), { productionTelemetry: true });

    const system: string = requests()[0]!.messages[0]!.content;

    expect(system).toContain("PRODUCTION telemetry");
    expect(system).toContain(
      "Ask what the task needs, and ask for several at once when you can.",
    );
    // No count of calls (a command's own timeout is not one).
    expect(system).not.toMatch(/at most \d+ (of these )?calls?/i);
    expect(system).not.toContain("of these calls");
    expect(everyMessageText().toLowerCase()).not.toContain("budget");
  });
});

describe("the project's limits per run, when it sets them", () => {
  test("model calls: the last call it allows is the answer, without tools, and the summary names the setting", async () => {
    const server: FakeServer = new FakeServer({ maxModelCalls: 5 });
    let calls: number = 0;

    llmCompletionMock.mockImplementation(async (request: CompletionRequest) => {
      if (!offeredTools(request)) {
        return server.answer({ content: "Changed the cart total." });
      }

      calls++;
      return server.answer({ toolCalls: [newSearch(calls)] });
    });

    const result: CodeAgentResult = await runAgent(makeWorkspace());

    // Four calls with tools, and the fifth - the project's last - the answer.
    expect(requests()).toHaveLength(5);
    expect(offeredTools(requests()[3])).toBe(true);
    expect(offeredTools(requests()[4])).toBe(false);
    expect(lastMessage(requests()[4]).content).toBe(
      `This is the last model call this run may make: the project allows 5 model calls per run. ${ANSWER_NOW}`,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toBe(
      `Changed the cart total.\n\n_This run stopped at this project's limit of 5 model calls per run. Change it in ${LIMITS_LOCATION}._`,
    );
    // The summary goes into pull request bodies: no Dashboard link in it.
    expect(result.summary).not.toContain("http");
  });

  test("tool calls: calls past the cap in one batch are skipped but answered, and the next call is the answer", async () => {
    const server: FakeServer = new FakeServer({ maxToolCalls: 3 });

    llmCompletionMock
      .mockImplementationOnce(async () => {
        return server.answer({
          toolCalls: [1, 2, 3, 4, 5].map((index: number): LLMToolCall => {
            return newSearch(index);
          }),
        });
      })
      .mockImplementation(async () => {
        return server.answer({ content: "Searched what I could." });
      });

    const result: CodeAgentResult = await runAgent(makeWorkspace());

    expect(requests()).toHaveLength(2);

    const answered: Array<LLMMessage> = toolMessages(requests()[1]!);

    // Every call answered, with its own id (the provider contract).
    expect(
      answered.map((message: LLMMessage): string => {
        return (message as unknown as { toolCallId: string }).toolCallId;
      }),
    ).toEqual(["search-1", "search-2", "search-3", "search-4", "search-5"]);
    expect(answered[2]!.content).not.toContain("Skipped");
    expect(answered[3]!.content).toBe(
      "Skipped: this run has made 3 tool calls, the most the project allows per run. Answer with the data you already have.",
    );
    expect(answered[4]!.content).toBe(answered[3]!.content);

    expect(offeredTools(requests()[1])).toBe(false);
    expect(lastMessage(requests()[1]).content).toBe(
      `This run has made 3 tool calls, the most the project allows per run. ${ANSWER_NOW}`,
    );
    expect(result.summary).toBe(
      `Searched what I could.\n\n_This run stopped at this project's limit of 3 tool calls per run. Change it in ${LIMITS_LOCATION}._`,
    );
  });

  test("tokens: a call that would reach the cap is the answer", async () => {
    // Each call uses 4,000 tokens: after two, a third would reach 10,000.
    const server: FakeServer = new FakeServer({ maxTokens: 10_000 }, 4000);
    let calls: number = 0;

    llmCompletionMock.mockImplementation(async (request: CompletionRequest) => {
      if (!offeredTools(request)) {
        return server.answer({ content: "Done within the tokens." });
      }

      calls++;
      return server.answer({ toolCalls: [newSearch(calls)] });
    });

    const result: CodeAgentResult = await runAgent(makeWorkspace());

    expect(requests()).toHaveLength(3);
    expect(offeredTools(requests()[1])).toBe(true);
    expect(offeredTools(requests()[2])).toBe(false);
    expect(lastMessage(requests()[2]).content).toBe(
      `This run is about to reach the project's limit of 10,000 tokens per run. ${ANSWER_NOW}`,
    );
    expect(result.summary).toBe(
      `Done within the tokens.\n\n_This run stopped at this project's limit of 10,000 tokens per run. Change it in ${LIMITS_LOCATION}._`,
    );
  });

  test("tokens: past the cap the task makes no further call, and ends with what it has", async () => {
    const server: FakeServer = new FakeServer({ maxTokens: 10_000 }, 12_000);

    llmCompletionMock.mockImplementation(async () => {
      return server.answer({
        content: "Looked at the cart.",
        toolCalls: [newSearch(1)],
      });
    });

    const result: CodeAgentResult = await runAgent(makeWorkspace());

    expect(requests()).toHaveLength(1);
    expect(result.success).toBe(true);
    expect(result.summary).toBe(
      `Looked at the cart.\n\n_This run stopped at this project's limit of 10,000 tokens per run. Change it in ${LIMITS_LOCATION}._`,
    );
  });

  test("limits the telemetry list gives up front hold before the first call", async () => {
    // An earlier attempt of the run made 2 of the project's 3 model calls.
    getTelemetryToolsMock.mockResolvedValue(
      telemetryOffer(runLimits({ maxModelCalls: 3, modelCallsUsed: 2 })),
    );
    llmCompletionMock.mockResolvedValue(
      new FakeServer({ maxModelCalls: 3 }).answer({ content: "Summary." }),
    );

    await runAgent(makeWorkspace(), { productionTelemetry: true });

    expect(requests()).toHaveLength(1);
    expect(offeredTools(requests()[0])).toBe(false);
    expect(lastMessage(requests()[0]).content).toContain(
      "the project allows 3 model calls per run",
    );
  });
});

describe("the run's time limit", () => {
  test("the time the server says is left winds the task down: its last call is the answer", async () => {
    const server: FakeServer = new FakeServer();

    llmCompletionMock
      .mockImplementationOnce(async () => {
        return server.answer({
          toolCalls: [newSearch(1)],
          limits: { timeLeftMs: 0 },
        });
      })
      .mockImplementation(async () => {
        return server.answer({ content: "Out of time; changed nothing." });
      });

    const result: CodeAgentResult = await runAgent(makeWorkspace());

    expect(requests()).toHaveLength(2);
    expect(offeredTools(requests()[1])).toBe(false);
    expect(lastMessage(requests()[1]).content).toBe(
      `This run has reached its time limit of 120 minutes. ${ANSWER_NOW}`,
    );
    expect(result.success).toBe(true);
    expect(result.summary).toBe(
      `Out of time; changed nothing.\n\n_This run stopped at the default time limit of 120 minutes per run. Change it in ${LIMITS_LOCATION}._`,
    );
  });

  test("a project's own time limit is named as the project's", async () => {
    const server: FakeServer = new FakeServer({
      timeLimitInMinutes: 45,
      timeLimitSource: AIRunTimeLimitSource.Project,
    });

    llmCompletionMock
      .mockImplementationOnce(async () => {
        return server.answer({
          toolCalls: [newSearch(1)],
          limits: { timeLeftMs: 0 },
        });
      })
      .mockImplementation(async () => {
        return server.answer({ content: "Stopped." });
      });

    const result: CodeAgentResult = await runAgent(makeWorkspace());

    expect(lastMessage(requests()[1]).content).toBe(
      `This run has reached its time limit of 45 minutes. ${ANSWER_NOW}`,
    );
    expect(result.summary).toBe(
      `Stopped.\n\n_This run stopped at this project's time limit of 45 minutes per run. Change it in ${LIMITS_LOCATION}._`,
    );
  });

  test("calls in a batch made once the time is up are skipped, and answered", async () => {
    const server: FakeServer = new FakeServer();

    llmCompletionMock
      .mockImplementationOnce(async () => {
        return server.answer({
          toolCalls: [newSearch(1), newSearch(2)],
          limits: { timeLeftMs: 0 },
        });
      })
      .mockImplementation(async () => {
        return server.answer({ content: "Stopped." });
      });

    await runAgent(makeWorkspace());

    const answered: Array<LLMMessage> = toolMessages(requests()[1]!);

    expect(answered).toHaveLength(2);
    for (const message of answered) {
      expect(message.content).toBe(
        "Skipped: this run has reached its time limit of 120 minutes. Answer with the data you already have.",
      );
    }
  });

  /*
   * The server says how long the run has left, and the agent keeps to that
   * on its own clock: a Runner whose clock is an hour ahead of the server's
   * does not read a deadline written in the server's time as long past.
   */
  test("the time left, not the server's clock: a Runner whose clock is off still keeps the run's time", async () => {
    const server: FakeServer = new FakeServer();

    llmCompletionMock
      .mockImplementationOnce(async () => {
        return server.answer({
          toolCalls: [newSearch(1)],
          limits: {
            deadlineAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            timeLeftMs: 60 * 60 * 1000,
          },
        });
      })
      .mockImplementation(async () => {
        return server.answer({ content: "Done." });
      });

    const result: CodeAgentResult = await runAgent(makeWorkspace());

    expect(requests()).toHaveLength(2);
    expect(offeredTools(requests()[1])).toBe(true);
    expect(result.summary).toBe("Done.");
  });

  test("the run's time comes first when it is sooner than the step's", async () => {
    const server: FakeServer = new FakeServer();

    llmCompletionMock
      .mockImplementationOnce(async () => {
        return server.answer({
          toolCalls: [newSearch(1)],
          limits: { timeLeftMs: 0 },
        });
      })
      .mockImplementation(async () => {
        return server.answer({ content: "Stopped." });
      });

    // The step has an hour; the run, no time left.
    const result: CodeAgentResult = await runAgent(makeWorkspace(), {
      timeoutMs: 60 * 60 * 1000,
    });

    expect(lastMessage(requests()[1]).content).toBe(
      `This run has reached its time limit of 120 minutes. ${ANSWER_NOW}`,
    );
    expect(result.summary).toContain(
      "the default time limit of 120 minutes per run",
    );
  });

  test("with no step time, a task is held to the run's time alone - not to 30 minutes", async () => {
    const realNow: () => number = Date.now;
    let offsetMs: number = 0;
    const nowSpy: jest.SpyInstance = jest
      .spyOn(Date, "now")
      .mockImplementation((): number => {
        return realNow() + offsetMs;
      });

    try {
      const server: FakeServer = new FakeServer();
      let calls: number = 0;

      llmCompletionMock.mockImplementation(async () => {
        if (calls < 3) {
          calls++;
          // Each call takes 20 minutes: 60 in all, twice the old 30.
          offsetMs += 20 * 60 * 1000;
          return server.answer({
            toolCalls: [newSearch(calls)],
            limits: { timeLeftMs: (120 - 20 * calls) * 60 * 1000 },
          });
        }

        return server.answer({ content: "Done in an hour." });
      });

      const result: CodeAgentResult = await runAgent(makeWorkspace());

      expect(result.success).toBe(true);
      expect(requests()).toHaveLength(4);
      expect(offeredTools(requests()[3])).toBe(true);
      expect(result.summary).toBe("Done in an hour.");
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("loop detection", () => {
  test("the same failing call three times stops the task, with a summary that says why", async () => {
    const server: FakeServer = new FakeServer();

    llmCompletionMock.mockImplementation(async (request: CompletionRequest) => {
      if (!offeredTools(request)) {
        return server.answer({ content: "Could not find the file." });
      }

      return server.answer({
        toolCalls: [toolCall("read_file", { path: "src/missing.ts" })],
      });
    });

    const result: CodeAgentResult = await runAgent(makeWorkspace());

    // Three failing reads, and the answer.
    expect(requests()).toHaveLength(4);
    expect(offeredTools(requests()[3])).toBe(false);
    expect(lastMessage(requests()[3]).content).toBe(
      `Your recent tool calls keep returning what you have already seen, so this run is going in circles. ${ANSWER_NOW}`,
    );
    expect(result.summary).toBe(
      "Could not find the file.\n\n_This run stopped early: it kept repeating calls that showed it nothing new._",
    );
  });

  test("rounds that show nothing new are nudged first, then stopped", async () => {
    const server: FakeServer = new FakeServer();

    llmCompletionMock.mockImplementation(async (request: CompletionRequest) => {
      if (!offeredTools(request)) {
        return server.answer({ content: "Read it." });
      }

      return server.answer({
        toolCalls: [toolCall("read_file", { path: "README.md" })],
      });
    });

    await runAgent(makeWorkspace());

    const nudge: string =
      "Your last 3 rounds of tool calls returned only results you had already seen. Do not repeat them: try a different approach, or answer with what you have.";

    // Told to change course after the fourth read, and stopped after the sixth.
    expect(lastMessage(requests()[4]).content).toBe(nudge);
    expect(
      requests()[3]!.messages.some((message: LLMMessage): boolean => {
        return message.content === nudge;
      }),
    ).toBe(false);
    expect(requests()).toHaveLength(7);
    expect(offeredTools(requests()[6])).toBe(false);
  });

  /*
   * A failing build or test is a result the model works on, not an error:
   * running the same failing command between edits is how a fix is made.
   */
  test("a command that fails the same way between edits is not a loop", async () => {
    const server: FakeServer = new FakeServer();
    let round: number = 0;

    llmCompletionMock.mockImplementation(async () => {
      if (round < 6) {
        round++;
        return server.answer({
          toolCalls: [
            toolCall(
              "write_file",
              {
                path: "src/cart.ts",
                content: `export const a = ${round + 1};\n`,
              },
              `write-${round}`,
            ),
            toolCall("run_command", { command: "false" }, `test-${round}`),
          ],
        });
      }

      return server.answer({ content: "Tests still fail; here is why." });
    });

    const result: CodeAgentResult = await runAgent(makeWorkspace());

    expect(requests()).toHaveLength(7);
    expect(
      requests().every((request: CompletionRequest): boolean => {
        return offeredTools(request);
      }),
    ).toBe(true);
    expect(result.summary).toBe("Tests still fail; here is why.");
  });
});

describe("production telemetry from a current server", () => {
  test("its calls are not counted apart: the run makes as many as it needs", async () => {
    const server: FakeServer = new FakeServer();
    let queries: number = 0;

    getTelemetryToolsMock.mockResolvedValue(
      telemetryOffer(runLimits({ modelCallsUsed: 0, tokensUsed: 0 })),
    );
    runTelemetryToolMock.mockImplementation(async () => {
      queries++;
      return {
        output: `- name=GET /cart/${queries} | count=${queries}`,
        rowCount: 1,
        citationLabel: "Trace analytics · cart-api",
        isTruncated: false,
        limits: runLimits({ toolCallsUsed: queries }),
        budget: null,
      };
    });

    let calls: number = 0;
    llmCompletionMock.mockImplementation(async () => {
      if (calls < 15) {
        calls++;
        return server.answer({
          toolCalls: [
            toolCall("query_traces", { limit: calls }, `query-${calls}`),
          ],
        });
      }

      return server.answer({ content: "Reviewed with 15 queries." });
    });

    const result: CodeAgentResult = await runAgent(makeWorkspace(), {
      productionTelemetry: true,
    });

    // Past the 12 the server used to allow, and offered all along.
    expect(runTelemetryToolMock).toHaveBeenCalledTimes(15);
    expect(
      requests().every((request: CompletionRequest): boolean => {
        return (request.tools || []).some(
          (tool: LLMToolDefinition): boolean => {
            return tool.name === "query_traces";
          },
        );
      }),
    ).toBe(true);
    expect(result.summary).toBe("Reviewed with 15 queries.");
  });

  test("the project's tool calls per run count them with every other tool call", async () => {
    const server: FakeServer = new FakeServer({ maxToolCalls: 2 });

    getTelemetryToolsMock.mockResolvedValue(
      telemetryOffer(
        runLimits({ maxToolCalls: 2, modelCallsUsed: 0, tokensUsed: 0 }),
      ),
    );
    runTelemetryToolMock.mockResolvedValue({
      output: "- name=GET /cart | count=1",
      rowCount: 1,
      citationLabel: "Trace analytics · cart-api",
      isTruncated: false,
      limits: runLimits({ maxToolCalls: 2, toolCallsUsed: 1 }),
      budget: null,
    });
    llmCompletionMock
      .mockImplementationOnce(async () => {
        return server.answer({
          toolCalls: [
            toolCall("read_file", { path: "README.md" }, "read"),
            toolCall("query_traces", { limit: 1 }, "query-1"),
            toolCall("query_traces", { limit: 2 }, "query-2"),
          ],
        });
      })
      .mockImplementation(async () => {
        return server.answer({ content: "Done." });
      });

    await runAgent(makeWorkspace(), { productionTelemetry: true });

    expect(runTelemetryToolMock).toHaveBeenCalledTimes(1);
    expect(toolMessages(requests()[1]!)[2]!.content).toBe(
      "Skipped: this run has made 2 tool calls, the most the project allows per run. Answer with the data you already have.",
    );
  });
});
