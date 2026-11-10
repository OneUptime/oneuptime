/*
 * ---------------------------------------------------------------------------
 * The in-house code agent as a CONTROL LOOP.
 *
 * InHouseCodeAgentTools.test.ts covers what each tool does to the repository.
 * This file covers the loop around them: how it winds down, how it stops,
 * and what it puts on the wire. InHouseCodeAgentRunLimits.test.ts covers the
 * run's own limits (issue #6440): none but the time limit and loop detection
 * by default, and the caps a project sets.
 *
 * These are the failure modes that do not look like bugs in a happy-path run
 * but decide whether a fix run ends with a useful pull request or with
 * nothing:
 *
 *   - THE WIND-DOWN. A server from before #6440 enforces a completion-call
 *     and output-token budget and will simply refuse the next call. If the
 *     loop rides into that wall it ends on a rejection with no summary — the
 *     run reports "no summary available" even though the agent did real
 *     work and the files are sitting in the workspace. Winding down one call
 *     early, with the tools withheld so the model cannot ask for more, is
 *     what turns that into an honest report.
 *   - THE PROVIDER CONTRACT. Every assistant tool call must be answered by
 *     exactly one tool message carrying the same id. A provider rejects a
 *     mismatched history outright, which fails the run mid-way with an opaque
 *     4xx.
 *   - WINDOWS. Tool output re-enters the model context, so a large file is
 *     shown a window at a time, each saying where to read on - never cut
 *     off where a change further down cannot be reached (issue #6441).
 * ---------------------------------------------------------------------------
 */

import InHouseCodeAgent from "../../CodeAgents/InHouseCodeAgent";
import {
  CodeAgentProgressEvent,
  CodeAgentResult,
} from "../../CodeAgents/CodeAgentInterface";
import CodeAgentCompletionRetry from "../../CodeAgents/CodeAgentCompletionRetry";
import { READ_FILE_MAX_WINDOW_CHARS } from "../../CodeAgents/Tools/CodeAgentToolLimits";
import { LLMMessage, LLMToolCall } from "Common/Server/Utils/LLM/LLMService";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const llmCompletionMock: jest.Mock = jest.fn();

jest.mock("../../Utils/BackendAPI", () => {
  return {
    __esModule: true,
    default: class {
      public async llmCompletion(...args: Array<unknown>): Promise<unknown> {
        return llmCompletionMock(...args);
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

jest.setTimeout(120000);

/*
 * The budget a server from before #6440 answers with (these tests' mocks
 * send no `limits`, so the agent winds down on it): plenty left.
 */
const HEALTHY_BUDGET: {
  completionCallsUsed: number;
  maxCompletionCalls: number;
  outputTokensUsed: number;
  maxOutputTokens: number;
} = {
  completionCallsUsed: 1,
  maxCompletionCalls: 40,
  outputTokensUsed: 100,
  maxOutputTokens: 100_000,
};

interface CompletionRequest {
  taskId: string;
  messages: Array<LLMMessage>;
  tools?: Array<unknown>;
}

const temporaryPaths: Array<string> = [];

function makeWorkspace(): string {
  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-agent-loop-"),
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
  fs.writeFileSync(
    path.join(dir, "src", "checkout.ts"),
    "export const a = 1;\n",
  );
  fs.writeFileSync(
    path.join(dir, "src", "cart.ts"),
    "export const cart = 2;\n",
  );
  fs.writeFileSync(path.join(dir, "README.md"), "# app\nTODO: fix checkout\n");
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

function completion(data: {
  content?: string;
  toolCalls?: Array<LLMToolCall>;
  budget?: Partial<typeof HEALTHY_BUDGET>;
}): unknown {
  const toolCalls: Array<LLMToolCall> = data.toolCalls || [];

  return {
    content: data.content ?? "",
    toolCalls,
    stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
    budget: { ...HEALTHY_BUDGET, ...(data.budget || {}) },
  };
}

async function runAgent(
  workspace: string,
  options?: { timeoutMs?: number },
): Promise<CodeAgentResult> {
  const agent: InHouseCodeAgent = new InHouseCodeAgent();
  await agent.initialize({ taskId: "run-1" });

  const result: CodeAgentResult = await agent.executeTask({
    workingDirectory: workspace,
    prompt: "Fix the bug.",
    timeoutMs: options?.timeoutMs ?? 60_000,
  });

  await agent.cleanup();

  return result;
}

// Every request the agent put on the wire, in order.
function requests(): Array<CompletionRequest> {
  return llmCompletionMock.mock.calls.map((call: Array<unknown>) => {
    return call[0] as CompletionRequest;
  });
}

/*
 * Whether a request offered the tool surface at all. The wind-down call must
 * OMIT it — a model told "no more tools" while still being handed them will
 * keep calling them.
 */
function offeredTools(request: CompletionRequest | undefined): boolean {
  return request?.tools !== undefined;
}

function toolOutputs(result: CodeAgentResult, toolName: string): Array<string> {
  return result.logs.filter((line: string) => {
    return line.startsWith(`[${toolName}]`);
  });
}

beforeEach(() => {
  llmCompletionMock.mockReset();
});

afterAll(() => {
  for (const target of temporaryPaths) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("initialization", () => {
  test("refuses to initialize without a task id — completions are run-scoped", async () => {
    await expect(
      new InHouseCodeAgent().initialize({ taskId: "" }),
    ).rejects.toThrow("requires config.taskId");
  });

  test("executeTask before initialize is an error result, not a crash", async () => {
    const result: CodeAgentResult = await new InHouseCodeAgent().executeTask({
      workingDirectory: makeWorkspace(),
      prompt: "Fix it.",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not initialized");
  });

  test("is always available — there is no external binary to find", async () => {
    await expect(new InHouseCodeAgent().isAvailable()).resolves.toBe(true);
  });
});

describe("the read-only tools", () => {
  test("read_file returns the file's content to the model", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall("read_file", { path: "src/cart.ts" })],
        }),
      )
      .mockResolvedValue(completion({ content: "Read it." }));

    const result: CodeAgentResult = await runAgent(workspace);

    expect(toolOutputs(result, "read_file").join("\n")).toContain(
      "export const cart = 2;",
    );
  });

  test("read_file on a missing path reports the error instead of failing the run", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall("read_file", { path: "src/nope.ts" })],
        }),
      )
      .mockResolvedValue(completion({ content: "Could not read it." }));

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(true);
    expect(toolOutputs(result, "read_file").join("\n")).toContain("Error");
  });

  test("list_directory marks directories so the model can navigate", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({ toolCalls: [toolCall("list_directory", { path: "." })] }),
      )
      .mockResolvedValue(completion({ content: "Listed." }));

    const result: CodeAgentResult = await runAgent(workspace);
    const output: string = toolOutputs(result, "list_directory").join("\n");

    expect(output).toContain("src/");
    expect(output).toContain("README.md");
  });

  test("search_files finds a match and reports line numbers", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall("search_files", { pattern: "TODO" })],
        }),
      )
      .mockResolvedValue(completion({ content: "Searched." }));

    const result: CodeAgentResult = await runAgent(workspace);

    expect(toolOutputs(result, "search_files").join("\n")).toContain(
      "README.md",
    );
  });

  /*
   * git grep exits non-zero both for "no matches" and for an invalid regex.
   * Neither is a failure of the run — the model has to be told so it can try
   * a different search rather than the agent aborting.
   */
  test("search_files with no matches reports that, rather than erroring out", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [
            toolCall("search_files", { pattern: "zzz-not-in-this-repo" }),
          ],
        }),
      )
      .mockResolvedValue(completion({ content: "Nothing found." }));

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(true);
    expect(toolOutputs(result, "search_files").join("\n")).toContain(
      "No matches found",
    );
  });

  test("search_files without a pattern is refused with an explanation", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({ toolCalls: [toolCall("search_files", {})] }),
      )
      .mockResolvedValue(completion({ content: "Done." }));

    const result: CodeAgentResult = await runAgent(workspace);

    expect(toolOutputs(result, "search_files").join("\n")).toContain(
      "pattern is required",
    );
  });

  /*
   * Tool output re-enters the model's context, so a file longer than one
   * read is shown a window at a time. The old read_file returned the first
   * 20,000 characters of a file and nothing more, so a change further down
   * (a customer's 2,000-line file, issue #6441) could not be made at all.
   */
  test("a large file is shown a window at a time, and says where to read on", async () => {
    const workspace: string = makeWorkspace();
    const lines: Array<string> = [];

    for (let index: number = 1; index <= 3000; index++) {
      lines.push(
        `export const value${index}: number = ${index}; // ${"padding ".repeat(4)}`,
      );
    }

    fs.writeFileSync(path.join(workspace, "big.ts"), `${lines.join("\n")}\n`);

    // What the model was shown last, as each call was made.
    const shown: Array<string> = [];

    llmCompletionMock.mockImplementation((request: CompletionRequest) => {
      const toolMessages: Array<LLMMessage> = request.messages.filter(
        (message: LLMMessage) => {
          return message.role === "tool";
        },
      );

      if (toolMessages.length > 0) {
        shown.push(toolMessages[toolMessages.length - 1]!.content);
      }

      const readArguments: Array<Record<string, unknown>> = [
        { path: "big.ts" },
        { path: "big.ts", start_line: 2990 },
      ];
      const next: Record<string, unknown> | undefined =
        readArguments[llmCompletionMock.mock.calls.length - 1];

      return Promise.resolve(
        next
          ? completion({ toolCalls: [toolCall("read_file", next)] })
          : completion({ content: "Read it." }),
      );
    });

    await runAgent(workspace);

    expect(shown).toHaveLength(2);

    const first: string = shown[0]!;
    const second: string = shown[1]!;

    // The first window: numbered lines from the top, within a window's size.
    expect(first.length).toBeLessThan(READ_FILE_MAX_WINDOW_CHARS + 300);
    expect(first.startsWith("     1\texport const value1: number = 1;")).toBe(
      true,
    );

    const readOn: RegExpMatchArray | null = first.match(
      /\[big\.ts: lines 1-(\d+) of 3000 \(a window holds about 60,000 characters\)\. Read on with start_line (\d+)\.\]$/,
    );

    expect(readOn).not.toBeNull();
    expect(Number(readOn![2])).toBe(Number(readOn![1]) + 1);
    expect(first).toContain(`export const value${readOn![1]}: number`);
    expect(first).not.toContain(
      `export const value${Number(readOn![1]) + 1}: number`,
    );

    // A window further down reaches the very end, and says it is the end.
    expect(second.startsWith("  2990\texport const value2990: number")).toBe(
      true,
    );
    expect(second).toContain("  3000\texport const value3000: number = 3000;");
    expect(second).toContain(
      "[big.ts: lines 2990-3000 of 3000. This is the end of the file.]",
    );
  });
});

describe("the provider contract", () => {
  /*
   * Providers reject a history where an assistant tool call has no matching
   * tool result — the run then dies mid-way on an opaque 4xx that looks like
   * an outage. Every call must be answered, including the ones the agent
   * REFUSED, which is the case most likely to be forgotten.
   */
  test("every assistant tool call is answered by exactly one tool message with its id", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [
            toolCall("read_file", { path: "src/cart.ts" }, "id-read"),
            // Refused by the git guard — still needs an answer.
            toolCall("run_command", { command: "git push" }, "id-refused"),
            // Unknown tool — still needs an answer.
            toolCall("nonexistent_tool", {}, "id-unknown"),
          ],
        }),
      )
      .mockResolvedValue(completion({ content: "Done." }));

    await runAgent(workspace);

    const finalMessages: Array<LLMMessage> = requests()[1]
      ?.messages as Array<LLMMessage>;

    const toolMessages: Array<LLMMessage> = finalMessages.filter(
      (message: LLMMessage) => {
        return message.role === "tool";
      },
    );

    expect(
      toolMessages.map((message: LLMMessage) => {
        return (message as unknown as { toolCallId: string }).toolCallId;
      }),
    ).toEqual(["id-read", "id-refused", "id-unknown"]);
  });

  test("the assistant turn carrying the tool calls is kept in the history", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          content: "Let me look.",
          toolCalls: [toolCall("read_file", { path: "src/cart.ts" })],
        }),
      )
      .mockResolvedValue(completion({ content: "Done." }));

    await runAgent(workspace);

    const assistantTurns: Array<LLMMessage> = (
      requests()[1]?.messages as Array<LLMMessage>
    ).filter((message: LLMMessage) => {
      return message.role === "assistant";
    });

    expect(assistantTurns).toHaveLength(1);
    expect(assistantTurns[0]?.content).toBe("Let me look.");
  });

  test("the run id travels with every completion — the server validates it", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall("read_file", { path: "README.md" })],
        }),
      )
      .mockResolvedValue(completion({ content: "Done." }));

    await runAgent(workspace);

    for (const request of requests()) {
      expect(request.taskId).toBe("run-1");
    }
  });

  test("the first message is the system prompt and carries the recipe", async () => {
    const workspace: string = makeWorkspace();
    llmCompletionMock.mockResolvedValue(completion({ content: "Nothing." }));

    await runAgent(workspace);

    const first: LLMMessage = (
      requests()[0]?.messages as Array<LLMMessage>
    )[0] as LLMMessage;

    expect(first.role).toBe("system");
    expect(first.content).toContain("Fix the bug.");
    // The tool-use contract is appended to the recipe.
    expect(first.content).toContain("run_command");
  });
});

describe("an older server's budget: the wind-down", () => {
  /*
   * REGRESSION-SHAPED. A server from before #6440 refuses the call after its
   * budget is spent. A loop that keeps asking for tools until it is refused
   * ends on an exception with no summary — so a run that did real work
   * reports "no summary available" and the reviewer gets a pull request
   * nobody can explain. Winding down one call early, WITH THE TOOLS
   * WITHHELD, is what guarantees a final answer.
   */
  test("one completion call left: the next call withholds the tools", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall("read_file", { path: "README.md" })],
          // 39 of 40 used → one remaining.
          budget: { completionCallsUsed: 39, maxCompletionCalls: 40 },
        }),
      )
      .mockResolvedValue(
        completion({ content: "Ran out of budget; here it is." }),
      );

    const result: CodeAgentResult = await runAgent(workspace);

    const sent: Array<CompletionRequest> = requests();

    expect(sent).toHaveLength(2);
    expect(offeredTools(sent[0])).toBe(true);
    // The wind-down call must not offer tools at all.
    expect(offeredTools(sent[1])).toBe(false);
    // The answer, and under it the sentence that says what stopped the run.
    expect(result.summary).toBe(
      "Ran out of budget; here it is.\n\n_This run stopped at the 40 calls this OneUptime server allows a run. A server from this release on allows as many as the work needs._",
    );
  });

  test("the wind-down call tells the model why it may not use tools", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall("read_file", { path: "README.md" })],
          budget: { completionCallsUsed: 39, maxCompletionCalls: 40 },
        }),
      )
      .mockResolvedValue(completion({ content: "Summary." }));

    await runAgent(workspace);

    const lastMessage: LLMMessage = (
      requests()[1]?.messages as Array<LLMMessage>
    ).slice(-1)[0] as LLMMessage;

    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toBe(
      "This is the last call this OneUptime server allows the run. Do not request any more tools. Reply now with a plain-text summary of the changes you made and anything left undone.",
    );
  });

  /*
   * The output-token budget is the other wall, and it is the one a verbose
   * model hits first. Below the reserve there is not enough left to produce a
   * useful summary, so the loop must stop asking for tools while it still
   * can.
   */
  test("output tokens below the reserve also forces the final answer", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall("read_file", { path: "README.md" })],
          budget: { outputTokensUsed: 99_000, maxOutputTokens: 100_000 },
        }),
      )
      .mockResolvedValue(completion({ content: "Wound down." }));

    await runAgent(workspace);

    const sent: Array<CompletionRequest> = requests();

    expect(sent).toHaveLength(2);
    expect(offeredTools(sent[1])).toBe(false);
  });

  test("a healthy budget keeps offering tools", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall("read_file", { path: "README.md" })],
        }),
      )
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall("read_file", { path: "src/cart.ts" })],
        }),
      )
      .mockResolvedValue(completion({ content: "Done." }));

    await runAgent(workspace);

    const sent: Array<CompletionRequest> = requests();

    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(offeredTools(sent[1])).toBe(true);
  });

  /*
   * The agent has no count of calls of its own any more (issue #6440): a
   * model that keeps asking for the same thing is stopped by loop
   * detection, long before anything else - not by a cap on calls.
   */
  test("a model that keeps asking for the same thing is stopped by loop detection, not by a count", async () => {
    const workspace: string = makeWorkspace();

    // Always asks for the same tool; the budget always looks healthy.
    llmCompletionMock.mockImplementation((request: CompletionRequest) => {
      if (!("tools" in request)) {
        return Promise.resolve(completion({ content: "Forced summary." }));
      }
      return Promise.resolve(
        completion({
          toolCalls: [toolCall("read_file", { path: "README.md" })],
        }),
      );
    });

    const result: CodeAgentResult = await runAgent(workspace);

    // One read that showed something, five that showed nothing new, the answer.
    expect(llmCompletionMock.mock.calls.length).toBe(7);
    expect(result.success).toBe(true);
    expect(result.summary).toBe(
      "Forced summary.\n\n_This run stopped early: it kept repeating calls that showed it nothing new._",
    );
  });
});

describe("stopping", () => {
  test("a completion with no tool calls ends the loop and becomes the summary", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock.mockResolvedValue(
      completion({ content: "Nothing needed changing." }),
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expect(llmCompletionMock).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe("Nothing needed changing.");
    expect(result.success).toBe(true);
  });

  test("a run with no summary at all still says so rather than reporting an empty string", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock.mockResolvedValue(completion({ content: "" }));

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.summary).toBe("No summary available");
  });

  /*
   * The server being unreachable, or refusing the call, is a HARD failure —
   * the pipeline reports it as an error rather than as "no fix found". A
   * throw here that got swallowed into success:true would resurrect exactly
   * the taxonomy bug the handlers were fixed for.
   */
  test("a failing completion is a hard failure, not a quiet success", async () => {
    const workspace: string = makeWorkspace();
    // The waits between attempts (a minute, then five) pass at once here.
    const sleep: jest.SpyInstance = jest
      .spyOn(CodeAgentCompletionRetry, "sleep")
      .mockResolvedValue(undefined);

    llmCompletionMock.mockRejectedValue(
      new Error("Failed to get LLM completion: ECONNREFUSED"),
    );

    try {
      const result: CodeAgentResult = await runAgent(workspace, {
        timeoutMs: 60 * 60_000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
      expect(result.filesModified).toEqual([]);
      expect(result.exitCode).toBe(1);
      // A server out of reach is waited out twice before the task fails.
      expect(llmCompletionMock).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
    } finally {
      sleep.mockRestore();
    }
  });

  test("a completion that fails midway is still a hard failure", async () => {
    const workspace: string = makeWorkspace();
    const sleep: jest.SpyInstance = jest
      .spyOn(CodeAgentCompletionRetry, "sleep")
      .mockResolvedValue(undefined);

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [
            toolCall("write_file", {
              path: "src/new-helper.ts",
              content: "export const a = 2;\n",
            }),
          ],
        }),
      )
      .mockRejectedValue(new Error("budget exhausted"));

    try {
      const result: CodeAgentResult = await runAgent(workspace, {
        timeoutMs: 60 * 60_000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("budget exhausted");
      // Any other failure a repeat could fix gets one more try, no more.
      expect(llmCompletionMock).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(1);
    } finally {
      sleep.mockRestore();
    }
  });

  /*
   * A step whose time is up is no failure (issue #6440): its last call is
   * made without tools, and its answer - what it changed - is the summary,
   * with a sentence that says the time stopped it.
   */
  test("a step whose time is up winds down to its summary rather than failing", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock.mockImplementation(async (request: CompletionRequest) => {
      // Outlive the 1 ms the test grants the whole step.
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 30);
      });

      if (!offeredTools(request)) {
        return completion({ content: "Changed nothing yet." });
      }

      return completion({
        toolCalls: [toolCall("read_file", { path: "README.md" })],
      });
    });

    const result: CodeAgentResult = await runAgent(workspace, { timeoutMs: 1 });

    expect(result.success).toBe(true);
    expect(offeredTools(requests().slice(-1)[0])).toBe(false);
    expect(
      (requests().slice(-1)[0]?.messages as Array<LLMMessage>).slice(-1)[0]
        ?.content,
    ).toBe(
      "This step has reached its time limit of 1 minute. Do not request any more tools. Reply now with a plain-text summary of the changes you made and anything left undone.",
    );
    expect(result.summary).toBe(
      "Changed nothing yet.\n\n_This step stopped at its time limit of 1 minute._",
    );
  });

  /*
   * The safety net under the wind-down: a task whose calls stop coming back
   * - well past its time - still ends, as a failure that names the timeout,
   * rather than holding the Runner.
   */
  test("a task still going well past its time fails as timed out", async () => {
    const workspace: string = makeWorkspace();
    const realNow: () => number = Date.now;
    let offsetMs: number = 0;
    const nowSpy: jest.SpyInstance = jest
      .spyOn(Date, "now")
      .mockImplementation((): number => {
        return realNow() + offsetMs;
      });

    try {
      llmCompletionMock.mockImplementation(async () => {
        // This call took ten minutes past the step's one.
        offsetMs += 11 * 60 * 1000;

        return completion({
          toolCalls: [toolCall("read_file", { path: "README.md" })],
        });
      });

      const result: CodeAgentResult = await runAgent(workspace, {
        timeoutMs: 60_000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
      expect(llmCompletionMock).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("abort stops the loop and reports it", async () => {
    const workspace: string = makeWorkspace();
    const agent: InHouseCodeAgent = new InHouseCodeAgent();
    await agent.initialize({ taskId: "run-1" });

    llmCompletionMock.mockImplementation(async () => {
      await agent.abort();
      return completion({
        toolCalls: [toolCall("read_file", { path: "README.md" })],
      });
    });

    const result: CodeAgentResult = await agent.executeTask({
      workingDirectory: workspace,
      prompt: "Fix it.",
      timeoutMs: 60_000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("aborted");

    await agent.cleanup();
  });
});

describe("narration", () => {
  /*
   * The activity feed is how a human follows a run in progress. A tool call
   * that executes without narrating leaves a silent gap in the trail exactly
   * where something interesting happened.
   */
  test("every tool call is narrated to the progress callback", async () => {
    const workspace: string = makeWorkspace();
    const events: Array<CodeAgentProgressEvent> = [];

    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [
            toolCall("read_file", { path: "README.md" }, "a"),
            toolCall("list_directory", { path: "src" }, "b"),
            toolCall("run_command", { command: "git push" }, "c"),
          ],
        }),
      )
      .mockResolvedValue(completion({ content: "Done." }));

    const agent: InHouseCodeAgent = new InHouseCodeAgent();
    await agent.initialize({ taskId: "run-1" });
    agent.onProgress((event: CodeAgentProgressEvent) => {
      events.push(event);
    });

    await agent.executeTask({
      workingDirectory: workspace,
      prompt: "Fix it.",
      timeoutMs: 60_000,
    });
    await agent.cleanup();

    // Including the refused one — a refusal is the most interesting event.
    expect(events).toHaveLength(3);
    expect(events[0]?.message).toContain("read README.md");
    expect(events[2]?.message).toContain("refused");
  });

  test("the service path is put in front of the model when the repo has one", async () => {
    const workspace: string = makeWorkspace();
    llmCompletionMock.mockResolvedValue(completion({ content: "Done." }));

    const agent: InHouseCodeAgent = new InHouseCodeAgent();
    await agent.initialize({ taskId: "run-1" });
    await agent.executeTask({
      workingDirectory: workspace,
      prompt: "Fix the bug.",
      servicePath: "packages/checkout",
      timeoutMs: 60_000,
    });
    await agent.cleanup();

    const systemPrompt: string = (
      (requests()[0]?.messages as Array<LLMMessage>)[0] as LLMMessage
    ).content;

    expect(systemPrompt).toContain("packages/checkout");
  });
});
