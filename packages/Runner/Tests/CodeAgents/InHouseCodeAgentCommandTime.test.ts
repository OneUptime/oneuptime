/*
 * ---------------------------------------------------------------------------
 * How long the code agent's own commands run, and that its run stays alive
 * while they do (InHouseCodeAgent.toolRunCommand + Utils/AgentCommandLimits).
 *
 * Before: every command the model composed was killed at 120 seconds, so a
 * test suite or a build that takes three minutes could never pass on a
 * Runner of the project's own - and a longer limit alone would have let the
 * server's stale-run sweeper (12 minutes of silence) fail the run while the
 * command was still running, because a command makes no LLM call and posts
 * no log.
 *
 * Now a command gets two minutes unless the model sets timeout_seconds, up
 * to ten, never past the time the task has left, and while it runs the
 * Runner tells the server the run is still working (an InProgress status
 * report, which adds nothing to the run's trail).
 *
 * The agent is driven by scripted LLM completions against a real git
 * repository and real shell commands; only the server is faked.
 * ---------------------------------------------------------------------------
 */

import InHouseCodeAgent from "../../CodeAgents/InHouseCodeAgent";
import {
  CodeAgentResult,
  CodeAgentTask,
} from "../../CodeAgents/CodeAgentInterface";
import SecretRedactor from "../../Utils/SecretRedactor";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import { JSONObject } from "Common/Types/JSON";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "Common/Server/Utils/LLM/LLMService";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

interface ScriptedTurn {
  content: string;
  toolCalls: Array<LLMToolCall>;
}

const llmCompletionMock: jest.Mock = jest.fn();
const updateTaskStatusMock: jest.Mock = jest.fn();

/*
 * The keep-alive beats every two minutes in production; here it beats
 * every MOCK_KEEP_ALIVE_INTERVAL_MS, so a command of a second or two shows
 * whether the agent keeps its run alive, and stops when the command ends.
 * Only the interval changes: the agent's own beat is what runs.
 */
const MOCK_KEEP_ALIVE_INTERVAL_MS: number = 100;
const mockKeepAliveStarts: Array<number> = [];
const mockKeepAliveStops: Array<number> = [];

jest.mock("../../Utils/AgentCommandLimits", () => {
  const actual: typeof import("../../Utils/AgentCommandLimits") =
    jest.requireActual("../../Utils/AgentCommandLimits");

  return {
    __esModule: true,
    ...actual,
    startAgentCommandKeepAlive: (data: {
      intervalMs?: number | undefined;
      beat: () => Promise<void>;
    }): (() => void) => {
      mockKeepAliveStarts.push(
        data.intervalMs ?? actual.AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS,
      );

      const stop: () => void = actual.startAgentCommandKeepAlive({
        beat: data.beat,
        intervalMs: MOCK_KEEP_ALIVE_INTERVAL_MS,
      });

      return (): void => {
        mockKeepAliveStops.push(Date.now());
        stop();
      };
    },
  };
});

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

jest.setTimeout(120000);

const temporaryPaths: Array<string> = [];

function makeWorkspace(): string {
  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-agent-command-time-"),
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
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "baseline"]);

  return dir;
}

function toolCall(name: string, args: Record<string, unknown>): LLMToolCall {
  return {
    id: `call-${name}`,
    name,
    arguments: args,
  } as unknown as LLMToolCall;
}

function script(...turns: Array<ScriptedTurn>): void {
  llmCompletionMock.mockReset();

  for (const turn of turns) {
    llmCompletionMock.mockResolvedValueOnce({
      content: turn.content,
      toolCalls: turn.toolCalls,
      stopReason: turn.toolCalls.length > 0 ? "tool_use" : "stop",
      budget: {
        completionCallsUsed: 1,
        maxCompletionCalls: 40,
        outputTokensUsed: 100,
        maxOutputTokens: 100_000,
      },
    });
  }

  llmCompletionMock.mockResolvedValue({
    content: "Done.",
    toolCalls: [],
    stopReason: "stop",
    budget: {
      completionCallsUsed: 2,
      maxCompletionCalls: 40,
      outputTokensUsed: 200,
      maxOutputTokens: 100_000,
    },
  });
}

function scriptCommand(args: Record<string, unknown>): void {
  script(
    { content: "", toolCalls: [toolCall("run_command", args)] },
    { content: "Ran it.", toolCalls: [] },
  );
}

async function runAgent(
  workspace: string,
  timeoutMs: number = 60_000,
): Promise<CodeAgentResult> {
  const agent: InHouseCodeAgent = new InHouseCodeAgent();
  await agent.initialize({ taskId: "run-1" });

  const task: CodeAgentTask = {
    workingDirectory: workspace,
    prompt: "Run the tests.",
    timeoutMs,
  };

  const result: CodeAgentResult = await agent.executeTask(task);
  await agent.cleanup();

  return result;
}

// The verbatim run_command outputs the model was handed.
function commandOutputs(result: CodeAgentResult): string {
  return result.logs
    .filter((line: string) => {
      return line.startsWith("[run_command]");
    })
    .join("\n");
}

/*
 * The delays the kill timers of the commands were armed with: the only
 * setTimeout the agent arms with a command's own limit. Short timers the
 * jest runtime or a library arms are left out by their size.
 */
function commandTimerDelays(spy: jest.SpyInstance): Array<number> {
  return spy.mock.calls
    .map((call: Array<unknown>): unknown => {
      return call[1];
    })
    .filter((delay: unknown): delay is number => {
      return typeof delay === "number" && delay >= 1000;
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
}

beforeEach(() => {
  updateTaskStatusMock.mockReset();
  updateTaskStatusMock.mockResolvedValue(undefined);
  mockKeepAliveStarts.length = 0;
  mockKeepAliveStops.length = 0;
});

afterEach(() => {
  SecretRedactor.clearRegistered();
  jest.restoreAllMocks();
});

afterAll(() => {
  for (const target of temporaryPaths) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("how long a command may run", () => {
  test("a command the model gives one second is stopped at one second, and told how to ask for more", async () => {
    const workspace: string = makeWorkspace();

    scriptCommand({ command: "sleep 30", timeout_seconds: 1 });

    const startedAt: number = Date.now();
    const result: CodeAgentResult = await runAgent(workspace);
    const elapsed: number = Date.now() - startedAt;

    expect(result.success).toBe(true);
    expect(commandOutputs(result)).toContain(
      "Command timed out after 1 second. If it needs longer, such as a slow install, build or test suite, run it again with timeout_seconds (at most 600).",
    );
    // Stopped at its own second, not at the two minutes it used to get.
    expect(elapsed).toBeLessThan(15_000);
  });

  test("a command that asks for nothing gets two minutes", async () => {
    const workspace: string = makeWorkspace();
    const timerSpy: jest.SpyInstance = jest.spyOn(global, "setTimeout");

    scriptCommand({ command: "true" });

    await runAgent(workspace, 30 * 60 * 1000);

    expect(commandTimerDelays(timerSpy)).toContain(120_000);
  });

  test("a command that asks for five minutes gets five", async () => {
    const workspace: string = makeWorkspace();
    const timerSpy: jest.SpyInstance = jest.spyOn(global, "setTimeout");

    scriptCommand({ command: "true", timeout_seconds: 300 });

    await runAgent(workspace, 30 * 60 * 1000);

    expect(commandTimerDelays(timerSpy)).toContain(300_000);
  });

  test("a command that asks for an hour is held to ten minutes", async () => {
    const workspace: string = makeWorkspace();
    const timerSpy: jest.SpyInstance = jest.spyOn(global, "setTimeout");

    scriptCommand({ command: "true", timeout_seconds: 3600 });

    await runAgent(workspace, 30 * 60 * 1000);

    const delays: Array<number> = commandTimerDelays(timerSpy);

    expect(delays).toContain(600_000);
    expect(
      delays.some((delay: number): boolean => {
        return delay > 600_000 && delay !== 30 * 60 * 1000;
      }),
    ).toBe(false);
  });

  test("a command never runs past the time its task has left", async () => {
    const workspace: string = makeWorkspace();
    const timerSpy: jest.SpyInstance = jest.spyOn(global, "setTimeout");

    scriptCommand({ command: "true", timeout_seconds: 600 });

    // The task has a minute in all: the command gets what is left of it.
    await runAgent(workspace, 60_000);

    const commandDelay: number | undefined = commandTimerDelays(timerSpy).find(
      (delay: number): boolean => {
        return delay > 30_000 && delay <= 60_000;
      },
    );

    expect(commandDelay).toBeDefined();
    expect(commandTimerDelays(timerSpy)).not.toContain(600_000);
  });

  test("a timeout_seconds the model sends as text is read as its number", async () => {
    const workspace: string = makeWorkspace();
    const timerSpy: jest.SpyInstance = jest.spyOn(global, "setTimeout");

    scriptCommand({ command: "true", timeout_seconds: "240" });

    await runAgent(workspace, 30 * 60 * 1000);

    expect(commandTimerDelays(timerSpy)).toContain(240_000);
  });
});

describe("the run stays alive while a command runs", () => {
  test("the server hears the run is still working while a command runs, and nothing once it ends", async () => {
    const workspace: string = makeWorkspace();
    const beatTimes: Array<number> = [];
    let commandEndedAt: number = 0;

    updateTaskStatusMock.mockImplementation(async (): Promise<void> => {
      beatTimes.push(Date.now());
    });

    /*
     * The model's next call comes once the command has ended, and takes a
     * while: a keep-alive left running would beat into it.
     */
    llmCompletionMock.mockReset();
    llmCompletionMock.mockResolvedValueOnce({
      content: "",
      toolCalls: [
        toolCall("run_command", { command: "sleep 1.5", timeout_seconds: 30 }),
      ],
      stopReason: "tool_use",
      budget: {
        completionCallsUsed: 1,
        maxCompletionCalls: 40,
        outputTokensUsed: 100,
        maxOutputTokens: 100_000,
      },
    });
    llmCompletionMock.mockImplementationOnce(async (): Promise<unknown> => {
      commandEndedAt = Date.now();
      await sleep(MOCK_KEEP_ALIVE_INTERVAL_MS * 6);
      return {
        content: "Ran it.",
        toolCalls: [],
        stopReason: "stop",
        budget: {
          completionCallsUsed: 2,
          maxCompletionCalls: 40,
          outputTokensUsed: 200,
          maxOutputTokens: 100_000,
        },
      };
    });

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(true);
    expect(commandOutputs(result)).toContain("Exit code: 0");

    // About fifteen beats in a second and a half; at least a few.
    expect(updateTaskStatusMock.mock.calls.length).toBeGreaterThanOrEqual(3);

    for (const call of updateTaskStatusMock.mock.calls) {
      expect(call).toEqual(["run-1", AIAgentTaskStatus.InProgress]);
    }

    // The agent asked for the production interval: two minutes.
    expect(mockKeepAliveStarts).toEqual([2 * 60 * 1000]);

    // Stopped with the command: nothing more reaches the server.
    expect(mockKeepAliveStops).toHaveLength(1);
    expect(commandEndedAt).toBeGreaterThan(0);
    expect(
      beatTimes.filter((time: number): boolean => {
        return time > commandEndedAt;
      }),
    ).toEqual([]);

    const beatsAtEnd: number = updateTaskStatusMock.mock.calls.length;
    await sleep(MOCK_KEEP_ALIVE_INTERVAL_MS * 5);
    expect(updateTaskStatusMock.mock.calls.length).toBe(beatsAtEnd);
  });

  test("a command that runs out of time stops the keep-alive too", async () => {
    const workspace: string = makeWorkspace();

    scriptCommand({ command: "sleep 30", timeout_seconds: 1 });

    await runAgent(workspace);

    const beatsAtEnd: number = updateTaskStatusMock.mock.calls.length;
    expect(beatsAtEnd).toBeGreaterThanOrEqual(1);
    expect(mockKeepAliveStops).toHaveLength(1);

    await sleep(MOCK_KEEP_ALIVE_INTERVAL_MS * 5);
    expect(updateTaskStatusMock.mock.calls.length).toBe(beatsAtEnd);
  });

  test("a keep-alive the server refuses never breaks the command or the run", async () => {
    const workspace: string = makeWorkspace();

    updateTaskStatusMock.mockRejectedValue(new Error("502 Bad Gateway"));

    scriptCommand({ command: "sleep 0.6; echo built", timeout_seconds: 30 });

    const result: CodeAgentResult = await runAgent(workspace);

    expect(result.success).toBe(true);
    expect(commandOutputs(result)).toContain("built");
    expect(commandOutputs(result)).toContain("Exit code: 0");
    expect(updateTaskStatusMock).toHaveBeenCalled();
  });

  test("a quick command is never reported: nothing to keep alive", async () => {
    const workspace: string = makeWorkspace();

    scriptCommand({ command: "true" });

    await runAgent(workspace);

    // Started, and stopped before its first beat.
    expect(mockKeepAliveStarts).toHaveLength(1);
    expect(mockKeepAliveStops).toHaveLength(1);
    expect(updateTaskStatusMock.mock.calls.length).toBeLessThanOrEqual(1);
  });

  test("only a command keeps the run alive: the file tools never start a keep-alive", async () => {
    const workspace: string = makeWorkspace();

    script(
      {
        content: "",
        toolCalls: [
          toolCall("read_file", { path: "README.md" }),
          toolCall("list_directory", { path: "." }),
        ],
      },
      { content: "Read it.", toolCalls: [] },
    );

    await runAgent(workspace);

    expect(mockKeepAliveStarts).toHaveLength(0);
    expect(updateTaskStatusMock).not.toHaveBeenCalled();
  });
});

describe("what the model is told", () => {
  async function firstCompletionRequest(): Promise<{
    messages: Array<LLMMessage>;
    tools: Array<LLMToolDefinition>;
  }> {
    const workspace: string = makeWorkspace();

    script({ content: "Nothing to do.", toolCalls: [] });

    await runAgent(workspace);

    const request: JSONObject = llmCompletionMock.mock
      .calls[0]![0] as JSONObject;

    return {
      messages: request["messages"] as unknown as Array<LLMMessage>,
      tools: request["tools"] as unknown as Array<LLMToolDefinition>,
    };
  }

  test("run_command takes timeout_seconds, a whole number, and says what it defaults to and how far it goes", async () => {
    const { tools } = await firstCompletionRequest();

    const runCommand: LLMToolDefinition | undefined = tools.find(
      (tool: LLMToolDefinition): boolean => {
        return tool.name === "run_command";
      },
    );

    expect(runCommand).toBeDefined();
    expect(runCommand!.description).toBe(
      "Run a shell command in the repository root. It stops after 120 seconds unless timeout_seconds gives it longer. Returns the exit code and combined output (truncated).",
    );

    const schema: JSONObject = runCommand!.inputSchema as JSONObject;
    const properties: JSONObject = schema["properties"] as JSONObject;

    expect(properties["timeout_seconds"]).toEqual({
      type: "integer",
      description:
        "How long the command may run, in seconds: 120 when left out, at most 600. Give more only to a slow install, build or test suite.",
    });
    // Optional: a command needs no time limit to be run.
    expect(schema["required"]).toEqual(["command"]);
  });

  test("the system prompt gives the default, the argument and its most, and warns off commands that never end", async () => {
    const { messages } = await firstCompletionRequest();

    const system: string = messages[0]!.content;

    expect(system).toContain(
      [
        "- run_command runs a shell command in the repository root. Use it to",
        "  set up, build and run the tests the way the repository says to. A",
        "  command stops after 120 seconds; for a slow install, build or test",
        "  suite, set timeout_seconds (at most 600). Never start a command that",
        "  waits forever (a dev server, a watch mode).",
      ].join("\n"),
    );
    expect(system).not.toContain("120 second timeout");
  });
});
