/*
 * ---------------------------------------------------------------------------
 * A global Runner must never execute a project's configured commands or a
 * model-composed shell command.
 *
 * It serves AI code fixes for EVERY project that uses global Runners, beside
 * every project's JavaScript steps, so nothing one project configures (its
 * Setup/Build/Test command) and nothing a model composes runs on it.
 *
 * These tests drive the REAL code against a REAL git repository on disk and
 * assert on what ended up in the working tree: a command that WOULD run
 * writes a sentinel file, so "the file is absent" proves the command never
 * ran. Only the server says a Runner is global (GlobalRunnerMode), and the
 * rule is asked when a fix runs (Config.runsProjectAuthoredCommands), so each
 * case reloads the modules with jest.resetModules and sets what the server
 * said on the fresh GlobalRunnerMode.
 *
 * A project's own Runner is the counterpart: it DOES run both, exactly as
 * before, because it is the operator's own host with only that project's
 * credentials — the same trust model as a runbook Bash step. Breaking that
 * would be a regression, so both halves are pinned here.
 * ---------------------------------------------------------------------------
 */

import type InHouseCodeAgentType from "../../CodeAgents/InHouseCodeAgent";
import type BuildVerificationType from "../../Utils/BuildVerification";
import type {
  CodeAgentResult,
  CodeAgentTask,
} from "../../CodeAgents/CodeAgentInterface";
import type { LLMToolCall } from "Common/Server/Utils/LLM/LLMService";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

jest.setTimeout(120000);

/*
 * One scripted completion per turn. llmCompletionMock is only dereferenced
 * inside the method body so the hoisted jest.mock factory does not hit the
 * TDZ (same shape as InHouseCodeAgentTools.test.ts).
 */
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

const temporaryPaths: Array<string> = [];

function makeWorkspace(): string {
  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "global-runner-safety-"),
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
    "export function checkout(): number {\n  return 1;\n}\n",
  );
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

/*
 * The model makes the given tool calls on turn one, then a plain summary.
 * `tools` from the first completion call is captured so a test can assert
 * which tools the agent advertised.
 */
function scriptToolsThenSummary(calls: Array<LLMToolCall>): void {
  llmCompletionMock.mockReset();
  llmCompletionMock.mockResolvedValueOnce({
    content: "",
    toolCalls: calls,
    stopReason: "tool_use",
    budget: {
      completionCallsUsed: 1,
      maxCompletionCalls: 40,
      outputTokensUsed: 100,
      maxOutputTokens: 100_000,
    },
  });
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

interface LoadedModules {
  InHouseCodeAgent: typeof InHouseCodeAgentType;
  BuildVerification: typeof BuildVerificationType;
  runsProjectAuthoredCommands: () => boolean;
  // What the server says, on this copy of the modules.
  setGlobalByServer: (isGlobalRunner: boolean) => void;
}

/*
 * A fresh copy of the Runner's modules, with what the server said about the
 * Runner (isGlobalRunner on registration and every heartbeat) set on it.
 */
function loadForScope(
  isGlobalRunner: boolean,
  clusterKey: string | null = null,
): LoadedModules {
  jest.resetModules();

  if (clusterKey === null) {
    delete process.env["ONEUPTIME_SECRET"];
  } else {
    process.env["ONEUPTIME_SECRET"] = clusterKey;
  }

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const Config: {
    runsProjectAuthoredCommands: () => boolean;
  } = require("../../Config");
  const GlobalRunnerMode: {
    default: { setFromServer: (isGlobalRunner: boolean) => void };
  } = require("../../Utils/GlobalRunnerMode");

  GlobalRunnerMode.default.setFromServer(isGlobalRunner);

  return {
    InHouseCodeAgent: (
      require("../../CodeAgents/InHouseCodeAgent") as {
        default: typeof InHouseCodeAgentType;
      }
    ).default,
    BuildVerification: (
      require("../../Utils/BuildVerification") as {
        default: typeof BuildVerificationType;
      }
    ).default,
    runsProjectAuthoredCommands: Config.runsProjectAuthoredCommands,
    setGlobalByServer: (value: boolean): void => {
      GlobalRunnerMode.default.setFromServer(value);
    },
  };
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
}

async function runAgent(
  InHouseCodeAgent: typeof InHouseCodeAgentType,
  workspace: string,
): Promise<CodeAgentResult> {
  const agent: InHouseCodeAgentType = new InHouseCodeAgent();
  await agent.initialize({ taskId: "run-1" });

  const task: CodeAgentTask = {
    workingDirectory: workspace,
    prompt: "Fix the bug.",
    timeoutMs: 60_000,
  };

  const result: CodeAgentResult = await agent.executeTask(task);
  await agent.cleanup();
  return result;
}

// The `tools` the agent advertised on its first completion call.
function advertisedToolNames(): Array<string> {
  const firstCall: Array<unknown> | undefined = llmCompletionMock.mock.calls[0];
  const payload: { tools?: Array<{ name: string }> } =
    (firstCall?.[0] as { tools?: Array<{ name: string }> }) || {};

  return (payload.tools || []).map((t: { name: string }) => {
    return t.name;
  });
}

const savedSecret: string | undefined = process.env["ONEUPTIME_SECRET"];

afterEach(() => {
  jest.resetModules();
});

afterAll(() => {
  if (savedSecret === undefined) {
    delete process.env["ONEUPTIME_SECRET"];
  } else {
    process.env["ONEUPTIME_SECRET"] = savedSecret;
  }

  for (const dir of temporaryPaths) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const CLUSTER_KEY: string = "a-long-random-cluster-key-for-the-test";

describe("a global Runner does not run shell commands", () => {
  test("Config: a global Runner runs no project-authored command", () => {
    const mods: LoadedModules = loadForScope(true);
    expect(mods.runsProjectAuthoredCommands()).toBe(false);
  });

  test("the code agent does not advertise run_command, and a model-sent run_command never spawns", async () => {
    const mods: LoadedModules = loadForScope(true);
    const workspace: string = makeWorkspace();

    scriptToolsThenSummary([
      toolCall("run_command", {
        command: "echo ran > COMMAND_RAN.txt",
      }),
    ]);

    const result: CodeAgentResult = await runAgent(
      mods.InHouseCodeAgent,
      workspace,
    );

    // run_command was never offered to the model.
    expect(advertisedToolNames()).not.toContain("run_command");
    expect(advertisedToolNames()).toContain("write_file");

    // The command never ran: its sentinel file does not exist.
    expect(fs.existsSync(path.join(workspace, "COMMAND_RAN.txt"))).toBe(false);

    // And the model was told, verbatim, that it is not available here.
    const runCommandOutput: string = result.logs
      .filter((line: string) => {
        return line.startsWith("[run_command]");
      })
      .join("\n");
    expect(runCommandOutput).toContain("not available on this Runner");
  });

  test("verification is skipped without running the repository's setup command", async () => {
    const mods: LoadedModules = loadForScope(true);
    const workspace: string = makeWorkspace();

    const outcome: Awaited<
      ReturnType<typeof BuildVerificationType.verifyWithRepairs>
    > = await mods.BuildVerification.verifyWithRepairs({
      repo: {
        setupCommand: "echo ran > SETUP_RAN.txt",
        buildCommand: null,
        testCommand: null,
      },
      repositoryPath: workspace,
      agent: {
        initialize: async (): Promise<void> => {},
        executeTask: async (): Promise<CodeAgentResult> => {
          throw new Error("the agent must not be asked to repair");
        },
        onProgress: (): void => {},
        isAvailable: async (): Promise<boolean> => {
          return true;
        },
        abort: async (): Promise<void> => {},
        cleanup: async (): Promise<void> => {},
      } as unknown as Parameters<
        typeof BuildVerificationType.verifyWithRepairs
      >[0]["agent"],
      originalPrompt: "Fix it",
      log: async (): Promise<void> => {},
    });

    // Reported honestly as skipped — never implying a green build.
    expect(outcome.status).toBe("Skipped");
    expect(outcome.summary).toContain(
      "a global Runner does not build or test the change",
    );
    expect(outcome.repairAttemptsUsed).toBe(0);
    // The configured command never ran: its sentinel file does not exist.
    expect(fs.existsSync(path.join(workspace, "SETUP_RAN.txt"))).toBe(false);
  });

  test("the command runner itself refuses, whoever calls it (the spawn point, not only verification)", async () => {
    const mods: LoadedModules = loadForScope(true);
    const workspace: string = makeWorkspace();

    const single: Awaited<ReturnType<typeof BuildVerificationType.runCommand>> =
      await mods.BuildVerification.runCommand({
        command: { label: "build", command: "echo ran > BUILD_RAN.txt" },
        repositoryPath: workspace,
      });

    const several: Awaited<
      ReturnType<typeof BuildVerificationType.runCommands>
    > = await mods.BuildVerification.runCommands({
      commands: [
        { label: "setup", command: "echo ran > SETUP_RAN.txt" },
        { label: "test", command: "echo ran > TEST_RAN.txt" },
      ],
      repositoryPath: workspace,
    });

    // Never reported as passed, so it cannot read as a green build.
    expect(single.passed).toBe(false);
    expect(single.outputTail).toContain("not run");
    expect(several.passed).toBe(false);
    expect(several.failedCommand?.label).toBe("setup");

    for (const sentinel of ["BUILD_RAN.txt", "SETUP_RAN.txt", "TEST_RAN.txt"]) {
      expect(fs.existsSync(path.join(workspace, sentinel))).toBe(false);
    }
  });

  test("the rule is asked when a fix runs: a Runner the server calls global stops running commands at once", async () => {
    const mods: LoadedModules = loadForScope(false);
    const workspace: string = makeWorkspace();

    const before: Awaited<ReturnType<typeof BuildVerificationType.runCommand>> =
      await mods.BuildVerification.runCommand({
        command: { label: "build", command: "echo ran > BEFORE.txt" },
        repositoryPath: workspace,
      });

    expect(before.passed).toBe(true);
    expect(fs.existsSync(path.join(workspace, "BEFORE.txt"))).toBe(true);

    // The next heartbeat says the Runner is global.
    mods.setGlobalByServer(true);

    const after: Awaited<ReturnType<typeof BuildVerificationType.runCommand>> =
      await mods.BuildVerification.runCommand({
        command: { label: "build", command: "echo ran > AFTER.txt" },
        repositoryPath: workspace,
      });

    expect(after.passed).toBe(false);
    expect(after.outputTail).toContain(
      "a global Runner does not run a repository's commands",
    );
    expect(fs.existsSync(path.join(workspace, "AFTER.txt"))).toBe(false);
  });
});

describe("a project's own Runner keeps running commands (no regression)", () => {
  test("Config: a project's own Runner runs project-authored commands", () => {
    const mods: LoadedModules = loadForScope(false);
    expect(mods.runsProjectAuthoredCommands()).toBe(true);
  });

  test("a cluster key in its environment changes nothing: there is no shared Runner to be any more", () => {
    const mods: LoadedModules = loadForScope(false, CLUSTER_KEY);
    expect(mods.runsProjectAuthoredCommands()).toBe(true);
  });

  test("the code agent advertises run_command and a model-sent run_command runs", async () => {
    const mods: LoadedModules = loadForScope(false);
    const workspace: string = makeWorkspace();

    scriptToolsThenSummary([
      toolCall("run_command", {
        command: "echo ran > COMMAND_RAN.txt",
      }),
    ]);

    await runAgent(mods.InHouseCodeAgent, workspace);

    expect(advertisedToolNames()).toContain("run_command");
    // The command ran: its sentinel file exists.
    expect(fs.existsSync(path.join(workspace, "COMMAND_RAN.txt"))).toBe(true);
  });

  test("verification runs the repository's setup command", async () => {
    const mods: LoadedModules = loadForScope(false);
    const workspace: string = makeWorkspace();

    const outcome: Awaited<
      ReturnType<typeof BuildVerificationType.verifyWithRepairs>
    > = await mods.BuildVerification.verifyWithRepairs({
      repo: {
        setupCommand: "echo ran > SETUP_RAN.txt",
        buildCommand: null,
        testCommand: null,
      },
      repositoryPath: workspace,
      agent: {
        initialize: async (): Promise<void> => {},
        executeTask: async (): Promise<CodeAgentResult> => {
          throw new Error("not reached: the command passes");
        },
        onProgress: (): void => {},
        isAvailable: async (): Promise<boolean> => {
          return true;
        },
        abort: async (): Promise<void> => {},
        cleanup: async (): Promise<void> => {},
      } as unknown as Parameters<
        typeof BuildVerificationType.verifyWithRepairs
      >[0]["agent"],
      originalPrompt: "Fix it",
      log: async (): Promise<void> => {},
    });

    expect(outcome.status).toBe("Passed");
    // The configured command ran: its sentinel file exists.
    expect(fs.existsSync(path.join(workspace, "SETUP_RAN.txt"))).toBe(true);
  });

  test("the command runner runs a repository's command", async () => {
    const mods: LoadedModules = loadForScope(false);
    const workspace: string = makeWorkspace();

    const result: Awaited<ReturnType<typeof BuildVerificationType.runCommand>> =
      await mods.BuildVerification.runCommand({
        command: { label: "build", command: "echo ran > BUILD_RAN.txt" },
        repositoryPath: workspace,
      });

    expect(result.passed).toBe(true);
    expect(fs.existsSync(path.join(workspace, "BUILD_RAN.txt"))).toBe(true);
  });
});
