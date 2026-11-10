/*
 * ---------------------------------------------------------------------------
 * A model call that fails, and what the code agent does about it (issue
 * #6441).
 *
 * A code task used to fail on the first model call that failed - a provider
 * overloaded for a minute, the OneUptime server restarting under it - and
 * everything the task had read and changed was thrown away. Now:
 *
 *   - a server out of reach, or a provider down or overloaded, is waited
 *     out (a minute, then five), the run kept alive meanwhile, and the same
 *     call made again - never a tool run twice;
 *   - a refusal no repeat gets past fails the task at once, in the
 *     server's words;
 *   - a conversation too long for the model's window is cut to half and
 *     asked again at once;
 *   - no wait goes past the task's time, and an abort ends a wait and a
 *     call in flight.
 *
 * The real agent against a real repository, with a scripted model and the
 * waits replaced (CodeAgentCompletionRetry.sleep): no test waits a minute.
 * ---------------------------------------------------------------------------
 */

import InHouseCodeAgent from "../../CodeAgents/InHouseCodeAgent";
import CodeAgentCompletionRetry from "../../CodeAgents/CodeAgentCompletionRetry";
import { CodeAgentResult } from "../../CodeAgents/CodeAgentInterface";
import LlmCompletionError from "../../Utils/LlmCompletionError";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import { LLMMessage, LLMToolCall } from "Common/Server/Utils/LLM/LLMService";
import logger from "Common/Server/Utils/Logger";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const llmCompletionMock: jest.Mock = jest.fn();
const updateTaskStatusMock: jest.Mock = jest.fn();

jest.mock("../../Utils/BackendAPI", () => {
  return {
    __esModule: true,
    default: class {
      public async llmCompletion(...args: Array<unknown>): Promise<unknown> {
        return llmCompletionMock(...args);
      }

      public async updateTaskStatus(...args: Array<unknown>): Promise<void> {
        return updateTaskStatusMock(...args);
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

jest.setTimeout(60000);

interface CompletionRequest {
  messages: Array<LLMMessage>;
  tools?: Array<unknown>;
  timeoutInMs?: number;
  signal?: AbortSignal;
}

const temporaryPaths: Array<string> = [];
let sleepSpy: jest.SpyInstance;
// What each request held as it was made (the agent's array changes after).
let sent: Array<string> = [];

function makeWorkspace(files: Record<string, string> = {}): string {
  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-agent-retry-"),
  );
  temporaryPaths.push(dir);

  const run: (args: Array<string>) => void = (args: Array<string>): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };

  run(["init", "-q", "-b", "main", "."]);
  run(["config", "user.email", "tests@oneuptime.com"]);
  run(["config", "user.name", "Runner Tests"]);
  run(["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(dir, "README.md"), "# app\n");

  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }

  run(["add", "-A"]);
  run(["commit", "-q", "-m", "baseline"]);

  return dir;
}

function toolCall(
  name: string,
  args: Record<string, unknown>,
  id: string,
): LLMToolCall {
  return { id, name, arguments: args } as unknown as LLMToolCall;
}

function completion(data: {
  content?: string;
  toolCalls?: Array<LLMToolCall>;
}): unknown {
  const toolCalls: Array<LLMToolCall> = data.toolCalls || [];

  return {
    content: data.content ?? "",
    toolCalls,
    stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
    budget: {
      completionCallsUsed: 1,
      maxCompletionCalls: 1000,
      outputTokensUsed: 100,
      maxOutputTokens: 10_000_000,
    },
  };
}

/*
 * The model's answers, in order: a value is the answer, an Error is a
 * failed call. Each request is recorded as it was made.
 */
function script(...answers: Array<unknown>): void {
  let index: number = 0;

  llmCompletionMock.mockImplementation((request: CompletionRequest) => {
    sent.push(JSON.stringify(request.messages));
    const answer: unknown = answers[Math.min(index, answers.length - 1)];
    index++;

    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  });
}

function unreachable(): LlmCompletionError {
  return new LlmCompletionError({
    message:
      "The OneUptime server could not be reached for the model call: connect ECONNREFUSED 127.0.0.1:443",
    isNetworkFailure: true,
  });
}

async function runAgent(
  workspace: string,
  options?: {
    timeoutMs?: number;
    onAgent?: (agent: InHouseCodeAgent) => void;
  },
): Promise<CodeAgentResult> {
  const agent: InHouseCodeAgent = new InHouseCodeAgent();
  await agent.initialize({ taskId: "run-1" });
  options?.onAgent?.(agent);

  const result: CodeAgentResult = await agent.executeTask({
    workingDirectory: workspace,
    prompt: "Fix the bug.",
    timeoutMs: options?.timeoutMs ?? 60 * 60_000,
  });

  await agent.cleanup();
  return result;
}

function toolLines(result: CodeAgentResult, toolName: string): Array<string> {
  return result.logs.filter((line: string) => {
    return line.startsWith(`[${toolName}]`);
  });
}

beforeEach(() => {
  llmCompletionMock.mockReset();
  updateTaskStatusMock.mockReset();
  updateTaskStatusMock.mockResolvedValue(undefined);
  sent = [];
  sleepSpy = jest
    .spyOn(CodeAgentCompletionRetry, "sleep")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  for (const dir of temporaryPaths) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("a model call that may work if made again", () => {
  test("a server out of reach is waited out, the run kept alive, and the same call made again", async () => {
    const workspace: string = makeWorkspace();

    script(
      completion({
        toolCalls: [toolCall("read_file", { path: "README.md" }, "c1")],
      }),
      unreachable(),
      completion({ content: "Read the README." }),
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Read the README.");
    expect(llmCompletionMock).toHaveBeenCalledTimes(3);
    // The repeat is the very call that failed: the same conversation.
    expect(sent[2]).toBe(sent[1]);
    // A minute, give or take a fifth.
    expect(sleepSpy).toHaveBeenCalledTimes(1);
    const waited: number = sleepSpy.mock.calls[0]![0] as number;
    expect(waited).toBeGreaterThanOrEqual(48_000);
    expect(waited).toBeLessThanOrEqual(72_000);
    // The run was kept alive while it waited.
    expect(updateTaskStatusMock).toHaveBeenCalledWith(
      "run-1",
      AIAgentTaskStatus.InProgress,
    );
    expect(result.logs.join("\n")).not.toContain("Error:");
  });

  test("a tool is never run twice: only the model call is made again", async () => {
    const workspace: string = makeWorkspace();

    script(
      completion({
        toolCalls: [
          toolCall("run_command", { command: "echo ran >> counter.txt" }, "c1"),
        ],
      }),
      unreachable(),
      unreachable(),
      completion({ content: "Done." }),
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(true);
    expect(toolLines(result, "run_command")).toHaveLength(1);
    expect(fs.readFileSync(path.join(workspace, "counter.txt"), "utf-8")).toBe(
      "ran\n",
    );
    expect(sleepSpy).toHaveBeenCalledTimes(2);
  });

  test("a provider unavailable (503) is waited out three times in all, then the task fails in the server's words", async () => {
    const workspace: string = makeWorkspace();

    script(
      new LlmCompletionError({
        message: "The AI provider is overloaded. Try again later.",
        statusCode: 503,
      }),
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "The AI provider is overloaded. Try again later.",
    );
    expect(llmCompletionMock).toHaveBeenCalledTimes(3);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
    // A minute, then five.
    expect(sleepSpy.mock.calls[1]![0] as number).toBeGreaterThanOrEqual(
      240_000,
    );
  });

  test("each wait is in the run's log", async () => {
    const workspace: string = makeWorkspace();
    const logged: Array<string> = [];

    script(unreachable(), completion({ content: "Done." }));

    const agent: InHouseCodeAgent = new InHouseCodeAgent();
    await agent.initialize({ taskId: "run-1" }, {
      info: async (message: string): Promise<void> => {
        logged.push(message);
      },
      toolCall: async (): Promise<void> => {},
    } as never);

    await agent.executeTask({
      workingDirectory: workspace,
      prompt: "Fix the bug.",
      timeoutMs: 60 * 60_000,
    });

    expect(logged.join("\n")).toMatch(
      /The model call failed \(The OneUptime server could not be reached for the model call: connect ECONNREFUSED 127\.0\.0\.1:443\)\. Trying again in \d+ seconds \(attempt 2 of 3\)\./,
    );
  });
});

describe("a model call no repeat gets past", () => {
  test("a refusal fails the task at once, in the server's words", async () => {
    const workspace: string = makeWorkspace();

    script(
      new LlmCompletionError({
        message: "This run is no longer running.",
        statusCode: 400,
      }),
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(false);
    expect(result.error).toBe("This run is no longer running.");
    expect(llmCompletionMock).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  test("a limit the project set fails the task at once", async () => {
    const workspace: string = makeWorkspace();

    script(
      new LlmCompletionError({
        message: "This project has reached its daily AI token limit.",
        statusCode: 429,
      }),
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(false);
    expect(llmCompletionMock).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });
});

describe("a conversation too long for the model's window", () => {
  test("is cut to half and asked again at once - and the task goes on", async () => {
    const big: string = Array.from(
      { length: 600 },
      (_: unknown, index: number) => {
        return `export const value${index}: string = "${"v".repeat(70)}";`;
      },
    ).join("\n");
    const workspace: string = makeWorkspace({ "src/big.ts": `${big}\n` });

    script(
      completion({
        toolCalls: [toolCall("read_file", { path: "src/big.ts" }, "c1")],
      }),
      new LlmCompletionError({
        message: "prompt is too long: 213000 tokens > 200000 maximum",
        statusCode: 400,
      }),
      completion({ content: "Read it." }),
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Read it.");
    expect(llmCompletionMock).toHaveBeenCalledTimes(3);
    expect(sleepSpy).not.toHaveBeenCalled();
    // The repeat carried less of the conversation, and every call its answer.
    expect(sent[2]!.length).toBeLessThan(sent[1]!.length / 2);
    const repeat: Array<LLMMessage> = JSON.parse(sent[2]!) as Array<LLMMessage>;
    expect(
      repeat.filter((message: LLMMessage) => {
        return message.role === "tool" && message.toolCallId === "c1";
      }),
    ).toHaveLength(1);
  });

  test("fails the task in the server's words once nothing more can be cut", async () => {
    const workspace: string = makeWorkspace();

    script(
      new LlmCompletionError({
        message:
          "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.",
        statusCode: 400,
      }),
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(false);
    expect(result.error).toContain("maximum context length is 8192 tokens");
    expect(sleepSpy).not.toHaveBeenCalled();
  });
});

/*
 * A proxy in front of the OneUptime server takes a request body up to a
 * size (nginx's own is 1 MB) and answers a larger one with 413 and a page
 * of its own - no words the agent knows. That is the conversation being
 * too large, not a refusal: it is cut and sent again, as for a full
 * context window.
 */
describe("a conversation larger than the server takes in one request", () => {
  function tooLarge(): LlmCompletionError {
    return new LlmCompletionError({
      message: "LLM completion request failed (HTTP 413)",
      statusCode: 413,
    });
  }

  test("is cut to half and sent again at once - and the task goes on", async () => {
    const big: string = Array.from(
      { length: 600 },
      (_: unknown, index: number) => {
        return `export const value${index}: string = "${"v".repeat(70)}";`;
      },
    ).join("\n");
    const workspace: string = makeWorkspace({ "src/big.ts": `${big}\n` });

    script(
      completion({
        toolCalls: [toolCall("read_file", { path: "src/big.ts" }, "c1")],
      }),
      tooLarge(),
      completion({ content: "Read it." }),
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Read it.");
    expect(llmCompletionMock).toHaveBeenCalledTimes(3);
    expect(sleepSpy).not.toHaveBeenCalled();
    expect(sent[2]!.length).toBeLessThan(sent[1]!.length / 2);
    // The run's log says why the conversation was cut.
    expect(
      (logger.debug as jest.Mock).mock.calls.map((args: Array<unknown>) => {
        return String(args[0]);
      }),
    ).toContain(
      "[InHouse] The conversation was larger than the OneUptime server takes in one request; trying again with less of it.",
    );
  });

  test("fails the task once nothing more can be cut, never waiting", async () => {
    const workspace: string = makeWorkspace();

    script(tooLarge());

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(false);
    expect(result.error).toBe("LLM completion request failed (HTTP 413)");
    expect(llmCompletionMock).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  test("any other refusal of the request is still a refusal", async () => {
    const workspace: string = makeWorkspace();

    script(
      new LlmCompletionError({
        message: "LLM completion request failed (HTTP 400)",
        statusCode: 400,
      }),
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(false);
    expect(llmCompletionMock).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });
});

describe("the task's time and an abort", () => {
  test("a wait that would end past the task's time is not made", async () => {
    const workspace: string = makeWorkspace();
    // Every wait at its longest: a minute and a fifth, then six minutes.
    jest.spyOn(Math, "random").mockReturnValue(0.9999);

    script(new LlmCompletionError({ message: "Bad gateway", statusCode: 502 }));

    // A second of its own, and five minutes for its last answer.
    const result: CodeAgentResult = await runAgent(workspace, {
      timeoutMs: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Bad gateway");
    // The first wait fits; the second (six minutes) would end too late.
    expect(sleepSpy).toHaveBeenCalledTimes(1);
    expect(llmCompletionMock).toHaveBeenCalledTimes(2);
  });

  test("every model call says how long it may take, and carries what gives it up", async () => {
    const workspace: string = makeWorkspace();

    script(completion({ content: "Done." }));

    await runAgent(workspace);

    const request: CompletionRequest = llmCompletionMock.mock
      .calls[0]![0] as CompletionRequest;
    expect(request.timeoutInMs).toBeGreaterThanOrEqual(2 * 60 * 1000);
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.signal!.aborted).toBe(false);
  });

  test("an abort during a wait ends the task as aborted", async () => {
    const workspace: string = makeWorkspace();
    let agentRef: InHouseCodeAgent | null = null;

    sleepSpy.mockImplementation(async (): Promise<void> => {
      await agentRef!.abort();
    });
    script(unreachable(), completion({ content: "never reached" }));

    const result: CodeAgentResult = await runAgent(workspace, {
      onAgent: (agent: InHouseCodeAgent) => {
        agentRef = agent;
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Task was aborted");
    expect(llmCompletionMock).toHaveBeenCalledTimes(1);
  });

  test("an abort gives up a model call in flight", async () => {
    const workspace: string = makeWorkspace();
    let agentRef: InHouseCodeAgent | null = null;
    let signalSeen: AbortSignal | undefined;

    llmCompletionMock.mockImplementation((request: CompletionRequest) => {
      signalSeen = request.signal;

      return new Promise(
        (
          _resolve: (value: unknown) => void,
          reject: (error: Error) => void,
        ) => {
          request.signal!.addEventListener("abort", () => {
            reject(new Error("canceled"));
          });
          void agentRef!.abort();
        },
      );
    });

    const result: CodeAgentResult = await runAgent(workspace, {
      onAgent: (agent: InHouseCodeAgent) => {
        agentRef = agent;
      },
    });

    expect(signalSeen!.aborted).toBe(true);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Task was aborted");
    expect(sleepSpy).not.toHaveBeenCalled();
  });
});
