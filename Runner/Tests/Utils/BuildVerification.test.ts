/*
 * ---------------------------------------------------------------------------
 * Unit tests for BuildVerification — the pre-PR build/test verification loop.
 *
 * The commands under verification are ordinary shell commands, so these tests
 * run REAL (fast) bash commands in throwaway fs.mkdtempSync directories
 * instead of mocking child_process: the contract that matters — "exit code 0
 * is a pass", "output tail keeps the END", "a failure stops the command
 * chain", "a spawn failure resolves instead of rejecting" — is only
 * meaningful against a real shell. Only the code agent is stubbed, through
 * the same CodeAgent interface the real loop uses, so the repair loop's
 * counting and stop conditions are exercised end to end.
 * ---------------------------------------------------------------------------
 */

import BuildVerification, {
  CommandRunResult,
  MAX_REPAIR_ATTEMPTS,
  VerificationCommand,
  VerificationOutcome,
} from "../../Utils/BuildVerification";
import {
  CodeAgent,
  CodeAgentResult,
  CodeAgentTask,
} from "../../CodeAgents/Index";
import { CodeRepositoryInfo } from "../../Utils/BackendAPI";
import RepositoryManager from "../../Utils/RepositoryManager";
import FixExceptionTaskHandler from "../../TaskHandlers/FixExceptionTaskHandler";
import WriteRegressionTestTaskHandler from "../../TaskHandlers/WriteRegressionTestTaskHandler";
import Execute from "Common/Server/Utils/Execute";
import FixVerificationStatus from "Common/Types/AI/FixVerificationStatus";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// Every temp directory created by a test, reaped once at the end.
const tempDirs: Array<string> = [];

function makeRepoDir(): string {
  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "build-verification-test-"),
  );
  tempDirs.push(dir);
  return dir;
}

// Run git synchronously, failing loudly — test setup, not code under test.
function git(repositoryPath: string, args: Array<string>): string {
  const result: SpawnSyncReturns<string> = spawnSync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${String(result.status)}): ${result.stderr}`,
    );
  }

  return result.stdout;
}

/*
 * A REAL git repository with one committed file. repairPaths and addPaths are
 * both claims about what git ends up staging, so they are tested against git
 * itself rather than a mock: the whole point of the fix is that `git add -A`
 * was sweeping in files git could see and the code could not.
 */
function makeGitRepoDir(): string {
  const dir: string = makeRepoDir();

  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "runner-tests@oneuptime.com"]);
  git(dir, ["config", "user.name", "Runner Tests"]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  fs.writeFileSync(path.join(dir, "README.md"), "baseline\n");
  git(dir, ["add", "--", "README.md"]);
  git(dir, ["commit", "-q", "-m", "baseline"]);

  return dir;
}

function stagedPaths(repositoryPath: string): Array<string> {
  return git(repositoryPath, ["diff", "--cached", "--name-only"])
    .split("\n")
    .filter((line: string) => {
      return line.trim().length > 0;
    });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, milliseconds);
  });
}

/*
 * A shell prologue that backgrounds a long-lived grandchild which INHERITS the
 * command's stdout/stderr pipes — the shape that used to hang runCommand
 * forever, because "close" only fires once every holder of the pipe is gone.
 * The pid is recorded so the test can reap it.
 */
const BACKGROUND_GRANDCHILD: string = "sleep 30 & echo $! > grandchild.pid;";

// Reap the grandchild a test deliberately left running.
function killBackgroundGrandchild(repositoryPath: string): void {
  const pidFile: string = path.join(repositoryPath, "grandchild.pid");

  if (!fs.existsSync(pidFile)) {
    return;
  }

  const pid: number = Number(fs.readFileSync(pidFile, "utf8").trim());

  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone — nothing to reap.
  }
}

// Set or unset an environment variable, restoring "absent" faithfully.
function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function buildRepo(
  commands: Partial<
    Pick<CodeRepositoryInfo, "setupCommand" | "buildCommand" | "testCommand">
  >,
): CodeRepositoryInfo {
  return {
    id: "repo-id",
    name: "checkout",
    repositoryHostedAt: "GitHub",
    organizationName: "acme",
    repositoryName: "checkout",
    mainBranchName: "main",
    setupCommand: null,
    buildCommand: null,
    testCommand: null,
    servicePathInRepository: null,
    gitHubAppInstallationId: "installation-id",
    ...commands,
  };
}

function agentResult(
  success: boolean,
  extra?: Partial<CodeAgentResult>,
): CodeAgentResult {
  return {
    success,
    filesModified: [],
    summary: success ? "Repaired the change." : "Could not repair.",
    logs: [],
    ...extra,
  };
}

type ExecuteTaskBehavior = (task: CodeAgentTask) => Promise<CodeAgentResult>;

/*
 * A CodeAgent whose executeTask is scripted by the test. It records every
 * task it receives so the tests can assert exactly how many repair passes
 * ran and what prompt each one carried.
 */
class StubCodeAgent implements CodeAgent {
  public readonly name: string = "Stub";
  public readonly tasks: Array<CodeAgentTask> = [];

  private readonly behavior: ExecuteTaskBehavior;

  public constructor(behavior: ExecuteTaskBehavior) {
    this.behavior = behavior;
  }

  public initialize(): Promise<void> {
    return Promise.resolve();
  }

  public executeTask(task: CodeAgentTask): Promise<CodeAgentResult> {
    this.tasks.push(task);
    return this.behavior(task);
  }

  public onProgress(): void {
    // Progress events are irrelevant to the verification loop.
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public abort(): Promise<void> {
    return Promise.resolve();
  }

  public cleanup(): Promise<void> {
    return Promise.resolve();
  }
}

// An agent whose executeTask must never run — Skipped/Passed paths.
function agentThatMustNotBeCalled(): StubCodeAgent {
  return new StubCodeAgent((): Promise<CodeAgentResult> => {
    return Promise.reject(
      new Error("the code agent must not be called on this path"),
    );
  });
}

const log: (message: string) => Promise<void> = (): Promise<void> => {
  return Promise.resolve();
};

describe("commandsForRepository", () => {
  test("a repository with no commands configured yields an empty list", () => {
    expect(
      BuildVerification.commandsForRepository({
        setupCommand: null,
        buildCommand: null,
        testCommand: null,
      }),
    ).toEqual([]);
  });

  test("whitespace-only commands are excluded, not run as empty shells", () => {
    expect(
      BuildVerification.commandsForRepository({
        setupCommand: "   ",
        buildCommand: "\n\t",
        testCommand: "npm test",
      }),
    ).toEqual([{ label: "test", command: "npm test" }]);
  });

  test("commands come out trimmed, in setup → build → test order", () => {
    expect(
      BuildVerification.commandsForRepository({
        testCommand: "  npm test  ",
        buildCommand: "npm run build",
        setupCommand: " npm ci ",
      }),
    ).toEqual([
      { label: "setup", command: "npm ci" },
      { label: "build", command: "npm run build" },
      { label: "test", command: "npm test" },
    ]);
  });
});

describe("runCommand", () => {
  test("exit code 0 is a pass with no failure details", async () => {
    const result: CommandRunResult = await BuildVerification.runCommand({
      command: { label: "test", command: "exit 0" },
      repositoryPath: makeRepoDir(),
    });

    expect(result.passed).toBe(true);
    expect(result.failedCommand).toBeUndefined();
    expect(result.outputTail).toBeUndefined();
  });

  test("a non-zero exit is a failure naming the label and exit code in the tail", async () => {
    const command: VerificationCommand = {
      label: "test",
      command: "echo compile blew up; exit 7",
    };

    const result: CommandRunResult = await BuildVerification.runCommand({
      command,
      repositoryPath: makeRepoDir(),
    });

    expect(result.passed).toBe(false);
    expect(result.failedCommand).toEqual(command);
    expect(result.outputTail).toContain("compile blew up");
    expect(result.outputTail).toContain("test command exited with code 7");
  });

  test("the tail carries BOTH stdout and stderr of the failed command", async () => {
    const result: CommandRunResult = await BuildVerification.runCommand({
      command: {
        label: "build",
        command: "echo written-to-stdout; echo written-to-stderr 1>&2; exit 1",
      },
      repositoryPath: makeRepoDir(),
    });

    expect(result.passed).toBe(false);
    expect(result.outputTail).toContain("written-to-stdout");
    expect(result.outputTail).toContain("written-to-stderr");
  });

  test("long output is bounded to an 8000-char tail that keeps the END", async () => {
    // ~24k chars of numbered filler between two distinctive markers.
    const result: CommandRunResult = await BuildVerification.runCommand({
      command: {
        label: "test",
        command: "echo START-MARKER; seq 1 5000; echo END-MARKER; exit 3",
      },
      repositoryPath: makeRepoDir(),
    });

    expect(result.passed).toBe(false);

    const tail: string = result.outputTail || "";
    // The end survives; the beginning is what gets dropped.
    expect(tail).toContain("END-MARKER");
    expect(tail).not.toContain("START-MARKER");
    expect(tail).toContain("test command exited with code 3");
    // 8000 chars of captured output plus only the short exit-code suffix.
    expect(tail.length).toBeGreaterThanOrEqual(8000);
    expect(tail.length).toBeLessThanOrEqual(8000 + 80);
  });

  test("a spawn failure (nonexistent directory) resolves as failed — never rejects", async () => {
    const result: CommandRunResult = await BuildVerification.runCommand({
      command: { label: "setup", command: "echo unreachable" },
      repositoryPath: path.join(
        os.tmpdir(),
        "build-verification-test-does-not-exist",
      ),
    });

    expect(result.passed).toBe(false);
    expect(result.failedCommand?.label).toBe("setup");
    expect(result.outputTail).toContain("Failed to start the setup command");
  });
});

/*
 * The teardown contract of runCommand. Every test here is a stopwatch test:
 * the bug being locked in is a command that never settles (or settles only
 * after the real 15-minute timeout), so what is asserted is that the promise
 * comes back in seconds, not that it eventually comes back.
 */
describe("runCommand: process group, stdin, and the settle guard", () => {
  test("a backgrounded grandchild holding stdout open does NOT hang the command", async () => {
    const dir: string = makeRepoDir();
    const startedAtMs: number = Date.now();

    const result: CommandRunResult = await BuildVerification.runCommand({
      command: {
        label: "test",
        command: `${BACKGROUND_GRANDCHILD} echo started; exit 0`,
      },
      repositoryPath: dir,
    });

    const elapsedMs: number = Date.now() - startedAtMs;

    try {
      /*
       * Settling on "exit" is the whole fix: the grandchild still owns the
       * stdio pipes, so "close" would not fire for another 30 seconds — and
       * for a real `npm test` daemon, never.
       */
      expect(elapsedMs).toBeLessThan(5000);
      expect(result.passed).toBe(true);
      expect(result.failedCommand).toBeUndefined();
    } finally {
      killBackgroundGrandchild(dir);
    }
  }, 20000);

  test("a non-zero exit with a lingering grandchild still reports the exit code", async () => {
    const dir: string = makeRepoDir();
    const startedAtMs: number = Date.now();

    const result: CommandRunResult = await BuildVerification.runCommand({
      command: {
        label: "build",
        command: `${BACKGROUND_GRANDCHILD} echo linker exploded; exit 9`,
      },
      repositoryPath: dir,
    });

    const elapsedMs: number = Date.now() - startedAtMs;

    try {
      expect(elapsedMs).toBeLessThan(5000);
      expect(result.passed).toBe(false);
      expect(result.failedCommand?.label).toBe("build");
      expect(result.outputTail).toContain("linker exploded");
      expect(result.outputTail).toContain("build command exited with code 9");
    } finally {
      killBackgroundGrandchild(dir);
    }
  }, 20000);

  test("output delivered after the shell exits still reaches the tail", async () => {
    /*
     * Settling the instant "exit" fires drops output the pipe has not handed
     * over yet. On Linux a plain `echo ...; exit 7` routinely delivers its
     * "data" event after "exit", so the tail kept the exit-code note and lost
     * the error explaining the failure — which is the entire point of the
     * tail. Large outputs hid it, because they fill the pipe and flush long
     * before the shell exits.
     *
     * Writing from a grandchild that outlives the shell forces that ordering
     * on every platform: the shell exits immediately, the write lands after,
     * and the tail must still carry it.
     */
    const result: CommandRunResult = await BuildVerification.runCommand({
      command: {
        label: "test",
        command: "(sleep 0.2; echo written-after-exit) & exit 7",
      },
      repositoryPath: makeRepoDir(),
    });

    expect(result.passed).toBe(false);
    expect(result.outputTail).toContain("written-after-exit");
    expect(result.outputTail).toContain("test command exited with code 7");
  }, 20000);

  test("the promise settles exactly once — a later stream close cannot change the result", async () => {
    const dir: string = makeRepoDir();

    // The grandchild outlives the shell by ~1s, so "close" fires after "exit".
    const pending: Promise<CommandRunResult> = BuildVerification.runCommand({
      command: { label: "test", command: "sleep 1 & echo started; exit 0" },
      repositoryPath: dir,
    });

    const first: CommandRunResult = await pending;
    expect(first.passed).toBe(true);

    // Outlive the grandchild, so whatever "close" would have done has happened.
    await wait(2500);

    const second: CommandRunResult = await pending;
    // Same settled value — the guard kept the first settle authoritative.
    expect(second).toBe(first);
    expect(second.passed).toBe(true);
    expect(second.failedCommand).toBeUndefined();
  }, 20000);

  test("stdin is /dev/null: a command that reads stdin gets EOF instead of blocking", async () => {
    const startedAtMs: number = Date.now();

    const result: CommandRunResult = await BuildVerification.runCommand({
      command: {
        label: "setup",
        command: "cat; read -r line || echo stdin-was-eof; exit 1",
      },
      repositoryPath: makeRepoDir(),
    });

    const elapsedMs: number = Date.now() - startedAtMs;

    // Before the fix, `cat` sat on an open stdin for the whole 15-min timeout.
    expect(elapsedMs).toBeLessThan(5000);
    expect(result.passed).toBe(false);
    expect(result.outputTail).toContain("stdin-was-eof");
  }, 20000);

  test("a secret-looking env value echoed by a command is redacted in the tail and in onOutput", async () => {
    const name: string = "ONEUPTIME_TEST_FAKE_TOKEN";
    const value: string = "supersecretvalue123";
    const original: string | undefined = process.env[name];
    const streamed: Array<string> = [];

    process.env[name] = value;

    try {
      const result: CommandRunResult = await BuildVerification.runCommand({
        command: {
          label: "test",
          command: `echo $${name}; exit 1`,
        },
        repositoryPath: makeRepoDir(),
        onOutput: (chunk: string): void => {
          streamed.push(chunk);
        },
      });

      expect(result.passed).toBe(false);
      // Redaction happens AT CAPTURE, so no copy of the raw value survives.
      expect(result.outputTail).toContain(`[redacted:${name}]`);
      expect(result.outputTail).not.toContain(value);
      expect(streamed.join("")).toContain(`[redacted:${name}]`);
      expect(streamed.join("")).not.toContain(value);
    } finally {
      setEnv(name, original);
    }
  });
});

describe("redactSecrets", () => {
  test("short values are left alone — blanket-replacing them would shred output", () => {
    const name: string = "ONEUPTIME_TEST_SHORT_VALUE";
    const original: string | undefined = process.env[name];
    // Seven characters: one under MIN_SECRET_VALUE_LENGTH.
    const value: string = "abc1234";

    process.env[name] = value;

    try {
      const redacted: string = BuildVerification.redactSecrets(
        `the build id is ${value} and that is fine`,
      );

      expect(redacted).toContain(value);
      expect(redacted).not.toContain("[redacted:");
    } finally {
      setEnv(name, original);
    }
  });

  test("allowlisted names are never redacted, however long their values", () => {
    const originals: Record<string, string | undefined> = {
      PATH: process.env["PATH"],
      HOME: process.env["HOME"],
      CI: process.env["CI"],
      NODE_ENV: process.env["NODE_ENV"],
    };

    const values: Record<string, string> = {
      PATH: "/opt/allowlisted-path-value-1234567890",
      HOME: "/home/allowlisted-home-value-1234567890",
      CI: "allowlisted-ci-value-1234567890",
      NODE_ENV: "allowlisted-node-env-value-1234567890",
    };

    let redacted: string = "";

    /*
     * Mutating PATH/HOME is safe because redactSecrets is synchronous — they
     * are restored before anything else in this process can observe them.
     */
    try {
      for (const [name, value] of Object.entries(values)) {
        process.env[name] = value;
      }

      redacted = BuildVerification.redactSecrets(
        Object.values(values).join(" | "),
      );
    } finally {
      for (const name of Object.keys(originals)) {
        setEnv(name, originals[name]);
      }
    }

    expect(redacted).not.toContain("[redacted:");

    for (const value of Object.values(values)) {
      expect(redacted).toContain(value);
    }
  });

  test("longest value first: an env value containing another is replaced whole", () => {
    const outerName: string = "ONEUPTIME_TEST_OUTER_SECRET";
    const innerName: string = "ONEUPTIME_TEST_INNER_SECRET";
    const outerValue: string = "supersecretvalue123";
    // A strict substring of the outer value.
    const innerValue: string = "secretvalue1";
    const originalOuter: string | undefined = process.env[outerName];
    const originalInner: string | undefined = process.env[innerName];

    process.env[outerName] = outerValue;
    process.env[innerName] = innerValue;

    try {
      const redacted: string = BuildVerification.redactSecrets(
        `TOKEN=${outerValue}`,
      );

      // Shortest-first ordering would leave "super[redacted:...]23" behind.
      expect(redacted).toBe(`TOKEN=[redacted:${outerName}]`);
      expect(redacted).not.toContain("super");
      expect(redacted).not.toContain(innerName);
    } finally {
      setEnv(outerName, originalOuter);
      setEnv(innerName, originalInner);
    }
  });

  test("redaction is pure and idempotent", () => {
    const name: string = "ONEUPTIME_TEST_IDEMPOTENT_SECRET";
    const original: string | undefined = process.env[name];
    const value: string = "idempotent-secret-value-1234567890";

    process.env[name] = value;

    try {
      const input: string = `a=${value} b=${value}`;
      const once: string = BuildVerification.redactSecrets(input);
      const twice: string = BuildVerification.redactSecrets(once);

      expect(once).toBe(`a=[redacted:${name}] b=[redacted:${name}]`);
      // Re-redacting redacted text changes nothing.
      expect(twice).toBe(once);
      // The input is not mutated, and the same input redacts the same way.
      expect(input).toBe(`a=${value} b=${value}`);
      expect(BuildVerification.redactSecrets(input)).toBe(once);
    } finally {
      setEnv(name, original);
    }
  });
});

describe("runCommands", () => {
  test("stops at the first failure — later commands never run", async () => {
    const dir: string = makeRepoDir();

    const result: CommandRunResult = await BuildVerification.runCommands({
      commands: [
        { label: "setup", command: "touch setup-ran.marker" },
        { label: "build", command: "echo build exploded 1>&2; exit 1" },
        { label: "test", command: "touch test-ran.marker" },
      ],
      repositoryPath: dir,
    });

    expect(result.passed).toBe(false);
    expect(result.failedCommand?.label).toBe("build");
    expect(result.outputTail).toContain("build exploded");
    // The command BEFORE the failure ran; the one after it did not.
    expect(fs.existsSync(path.join(dir, "setup-ran.marker"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "test-ran.marker"))).toBe(false);
  });

  test("all commands passing is a pass, and every command ran", async () => {
    const dir: string = makeRepoDir();

    const result: CommandRunResult = await BuildVerification.runCommands({
      commands: [
        { label: "setup", command: "touch setup-ran.marker" },
        { label: "test", command: "touch test-ran.marker" },
      ],
      repositoryPath: dir,
    });

    expect(result.passed).toBe(true);
    expect(result.failedCommand).toBeUndefined();
    expect(fs.existsSync(path.join(dir, "setup-ran.marker"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "test-ran.marker"))).toBe(true);
  });
});

describe("buildRepairPrompt", () => {
  test("carries the failed command, its label, the output tail, the original task, and the no-test-weakening rule", () => {
    const prompt: string = BuildVerification.buildRepairPrompt({
      originalPrompt: "Fix the checkout NPE from incident 123.",
      failed: {
        passed: false,
        failedCommand: { label: "test", command: "npm test -- --runInBand" },
        outputTail: "FAIL src/checkout.test.ts — expected 200, got 500",
      },
    });

    expect(prompt).toContain("npm test -- --runInBand");
    expect(prompt).toContain("test command failed");
    expect(prompt).toContain(
      "FAIL src/checkout.test.ts — expected 200, got 500",
    );
    expect(prompt).toContain("Fix the checkout NPE from incident 123.");
    expect(prompt).toContain("Do NOT weaken, skip, or delete existing tests");
  });
});

describe("verifyWithRepairs", () => {
  test("no commands configured: Skipped, and the agent is never called", async () => {
    const agent: StubCodeAgent = agentThatMustNotBeCalled();

    const outcome: VerificationOutcome =
      await BuildVerification.verifyWithRepairs({
        repo: buildRepo({}),
        repositoryPath: makeRepoDir(),
        agent,
        originalPrompt: "Fix the bug.",
        log,
      });

    expect(outcome.status).toBe(FixVerificationStatus.Skipped);
    expect(outcome.repairAttemptsUsed).toBe(0);
    // Nothing to stage and nothing to describe on the pull request.
    expect(outcome.repairPaths).toEqual([]);
    expect(outcome.repairSummaries).toEqual([]);
    // The skip is stated honestly, pointing at repository configuration.
    expect(outcome.summary).toContain(
      "no setup/build/test commands configured",
    );
    expect(agent.tasks).toHaveLength(0);
  });

  test("commands green on the first try: Passed with zero repairs, agent untouched", async () => {
    const agent: StubCodeAgent = agentThatMustNotBeCalled();

    const outcome: VerificationOutcome =
      await BuildVerification.verifyWithRepairs({
        repo: buildRepo({ buildCommand: "true", testCommand: "exit 0" }),
        repositoryPath: makeRepoDir(),
        agent,
        originalPrompt: "Fix the bug.",
        log,
      });

    expect(outcome.status).toBe(FixVerificationStatus.Passed);
    expect(outcome.repairAttemptsUsed).toBe(0);
    expect(outcome.summary).toContain("all passed");
    expect(outcome.summary).not.toContain("repair");
    expect(agent.tasks).toHaveLength(0);
  });

  test("fail once, agent repairs the tree: Passed after exactly one repair", async () => {
    const dir: string = makeRepoDir();

    // The "repair" is real: the agent creates the file the test checks for.
    const agent: StubCodeAgent = new StubCodeAgent(
      (task: CodeAgentTask): Promise<CodeAgentResult> => {
        fs.writeFileSync(path.join(task.workingDirectory, "fixed.marker"), "");
        return Promise.resolve(agentResult(true));
      },
    );

    const originalPrompt: string = "Fix the checkout NPE from incident 123.";

    const outcome: VerificationOutcome =
      await BuildVerification.verifyWithRepairs({
        repo: buildRepo({ testCommand: "test -f fixed.marker" }),
        repositoryPath: dir,
        agent,
        originalPrompt,
        log,
      });

    expect(outcome.status).toBe(FixVerificationStatus.Passed);
    expect(outcome.repairAttemptsUsed).toBe(1);
    expect(outcome.summary).toContain("1 automatic repair attempt");
    expect(agent.tasks).toHaveLength(1);

    // The repair pass ran in the workspace, with the full repair prompt.
    const repairTask: CodeAgentTask | undefined = agent.tasks[0];
    expect(repairTask?.workingDirectory).toBe(dir);
    expect(repairTask?.prompt).toContain("FAILED verification");
    expect(repairTask?.prompt).toContain(originalPrompt);
  });

  test("a command that never passes: Failed after exactly MAX_REPAIR_ATTEMPTS repair passes", async () => {
    const dir: string = makeRepoDir();

    // Agent claims success but changes nothing, so every re-verify fails.
    const agent: StubCodeAgent = new StubCodeAgent(
      (): Promise<CodeAgentResult> => {
        return Promise.resolve(agentResult(true));
      },
    );

    const outcome: VerificationOutcome =
      await BuildVerification.verifyWithRepairs({
        repo: buildRepo({
          testCommand: "echo run >> verify-runs.log; echo still broken; exit 1",
        }),
        repositoryPath: dir,
        agent,
        originalPrompt: "Fix the bug.",
        log,
      });

    expect(MAX_REPAIR_ATTEMPTS).toBe(2);
    expect(outcome.status).toBe(FixVerificationStatus.Failed);
    expect(outcome.repairAttemptsUsed).toBe(MAX_REPAIR_ATTEMPTS);
    expect(agent.tasks).toHaveLength(MAX_REPAIR_ATTEMPTS);
    expect(outcome.failedCommand?.label).toBe("test");
    expect(outcome.outputTail).toContain("still broken");
    expect(outcome.summary).toContain("2 repair attempts");

    // Initial verify + one re-verify after each of the two repairs.
    const verifyRuns: number = fs
      .readFileSync(path.join(dir, "verify-runs.log"), "utf8")
      .trim()
      .split("\n").length;
    expect(verifyRuns).toBe(1 + MAX_REPAIR_ATTEMPTS);
  });

  test("agent reports success:false (budget exhausted): loop stops early with no re-verify", async () => {
    const dir: string = makeRepoDir();

    const agent: StubCodeAgent = new StubCodeAgent(
      (): Promise<CodeAgentResult> => {
        return Promise.resolve(
          agentResult(false, { error: "LLM budget exhausted" }),
        );
      },
    );

    const outcome: VerificationOutcome =
      await BuildVerification.verifyWithRepairs({
        repo: buildRepo({
          testCommand: "echo run >> verify-runs.log; exit 1",
        }),
        repositoryPath: dir,
        agent,
        originalPrompt: "Fix the bug.",
        log,
      });

    expect(outcome.status).toBe(FixVerificationStatus.Failed);
    expect(agent.tasks).toHaveLength(1);

    // Only the initial verification ran — a failed repair is never re-verified.
    const verifyRuns: number = fs
      .readFileSync(path.join(dir, "verify-runs.log"), "utf8")
      .trim()
      .split("\n").length;
    expect(verifyRuns).toBe(1);
  });

  test("agent executeTask throwing is caught: Failed outcome, the loop never rejects", async () => {
    const agent: StubCodeAgent = new StubCodeAgent(
      (): Promise<CodeAgentResult> => {
        return Promise.reject(new Error("agent process crashed"));
      },
    );

    // Reaching these assertions at all proves verifyWithRepairs resolved.
    const outcome: VerificationOutcome =
      await BuildVerification.verifyWithRepairs({
        repo: buildRepo({ testCommand: "exit 1" }),
        repositoryPath: makeRepoDir(),
        agent,
        originalPrompt: "Fix the bug.",
        log,
      });

    expect(outcome.status).toBe(FixVerificationStatus.Failed);
    expect(agent.tasks).toHaveLength(1);
  });

  test("a very long failing command is truncated so the summary fits varchar(500)", async () => {
    /*
     * A ~490-character test command. Everything after "#" is a shell comment,
     * so this is a long command that still exits immediately.
     */
    const longCommand: string = `exit 1 # ${"pad-".repeat(120)}`;

    const outcome: VerificationOutcome =
      await BuildVerification.verifyWithRepairs({
        repo: buildRepo({ testCommand: longCommand }),
        repositoryPath: makeRepoDir(),
        // Claims success, changes nothing — the command keeps failing.
        agent: new StubCodeAgent((): Promise<CodeAgentResult> => {
          return Promise.resolve(agentResult(true));
        }),
        originalPrompt: "Fix the bug.",
        log,
      });

    expect(outcome.status).toBe(FixVerificationStatus.Failed);
    expect(longCommand.length).toBeGreaterThan(400);

    // The recorded summary rides in a varchar(500) column.
    expect(outcome.summary.length).toBeLessThanOrEqual(500);
    expect(outcome.summary).not.toContain(longCommand);
    // 117 characters of command, then the ellipsis and the closing backtick.
    expect(outcome.summary).toContain(longCommand.substring(0, 117));
    expect(outcome.summary).toContain("...`)");
    // The explanation AFTER the command is what the truncation protects.
    expect(outcome.summary).toContain("2 repair attempts");
    expect(outcome.summary).toContain("review the failure before merging");
  });
});

/*
 * repairPaths is the anti-`git add -A` fix: the caller stages exactly these
 * paths, so anything the repository's own build/test commands emitted must
 * never appear in the list. Run against a real git repository, because
 * listDirtyPaths asks git — not the filesystem — what changed.
 */
describe("verifyWithRepairs: repairPaths against a real git repository", () => {
  test("repairPaths names the repair agent's files and NOT the build output", async () => {
    const dir: string = makeGitRepoDir();

    const agent: StubCodeAgent = new StubCodeAgent(
      (task: CodeAgentTask): Promise<CodeAgentResult> => {
        fs.writeFileSync(
          path.join(task.workingDirectory, "src-fix.ts"),
          "export const fixed: boolean = true;\n",
        );
        return Promise.resolve(
          agentResult(true, {
            summary: "Added src-fix.ts so the failing test passes.",
          }),
        );
      },
    );

    const outcome: VerificationOutcome =
      await BuildVerification.verifyWithRepairs({
        repo: buildRepo({
          // Emits build output into the workspace, exactly like a real build.
          buildCommand:
            "mkdir -p dist && echo bundle > dist/bundle.js && echo log > build.log",
          testCommand: "test -f src-fix.ts",
        }),
        repositoryPath: dir,
        agent,
        originalPrompt: "Fix the bug.",
        log,
      });

    expect(outcome.status).toBe(FixVerificationStatus.Passed);
    expect(outcome.repairAttemptsUsed).toBe(1);

    // The build output really is sitting in the workspace, and git sees it...
    expect(fs.existsSync(path.join(dir, "dist", "bundle.js"))).toBe(true);
    expect(await BuildVerification.listDirtyPaths(dir)).toEqual(
      expect.arrayContaining(["build.log", "dist/bundle.js", "src-fix.ts"]),
    );

    // ...but only the repair pass's own file is offered up for staging.
    expect(outcome.repairPaths).toEqual(["src-fix.ts"]);
    expect(outcome.repairPaths).not.toContain("build.log");
    expect(outcome.repairPaths).not.toContain("dist/bundle.js");

    // The repair pass's summary is collected and reaches the pull request.
    expect(outcome.repairSummaries).toEqual([
      "Added src-fix.ts so the failing test passes.",
    ]);
    expect(BuildVerification.buildPullRequestBodySection(outcome)).toContain(
      "1. Added src-fix.ts so the failing test passes.",
    );
  });

  test("verification passing on the first try leaves repairPaths empty", async () => {
    const dir: string = makeGitRepoDir();

    const outcome: VerificationOutcome =
      await BuildVerification.verifyWithRepairs({
        repo: buildRepo({
          buildCommand: "echo log > build.log",
          testCommand: "true",
        }),
        repositoryPath: dir,
        agent: agentThatMustNotBeCalled(),
        originalPrompt: "Fix the bug.",
        log,
      });

    expect(outcome.status).toBe(FixVerificationStatus.Passed);
    expect(outcome.repairAttemptsUsed).toBe(0);
    expect(outcome.repairSummaries).toEqual([]);
    // The build output exists but no repair ran, so nothing extra is staged.
    expect(fs.existsSync(path.join(dir, "build.log"))).toBe(true);
    expect(outcome.repairPaths).toEqual([]);
  });
});

describe("buildPullRequestBodySection", () => {
  test("Passed renders the ✅ section with the summary", () => {
    const section: string = BuildVerification.buildPullRequestBodySection({
      status: FixVerificationStatus.Passed,
      summary: "build → test all passed at the repository root.",
      repairAttemptsUsed: 0,
      repairSummaries: [],
      repairPaths: [],
    });

    expect(section).toContain("## ✅ Verification");
    expect(section).toContain(
      "build → test all passed at the repository root.",
    );
    // No repairs ran, so no repair section is invented.
    expect(section).not.toContain("Repair passes");
  });

  test("Failed renders the ⚠️ section with the output tail in a <details> block", () => {
    const section: string = BuildVerification.buildPullRequestBodySection({
      status: FixVerificationStatus.Failed,
      summary: "The test command still failed after 2 repair attempts.",
      repairAttemptsUsed: 2,
      repairSummaries: [],
      repairPaths: [],
      failedCommand: { label: "test", command: "npm test" },
      outputTail: "error TS2345: Argument of type 'string' is not assignable.",
    });

    expect(section).toContain("## ⚠️ Verification failed");
    expect(section).toContain(
      "The test command still failed after 2 repair attempts.",
    );
    expect(section).toContain("<details>");
    expect(section).toContain(
      "error TS2345: Argument of type 'string' is not assignable.",
    );
    expect(section).not.toContain("Repair passes");
  });

  test("Passed after repairs lists every repair pass under a Repair passes heading", () => {
    const section: string = BuildVerification.buildPullRequestBodySection({
      status: FixVerificationStatus.Passed,
      summary: "build → test all passed (after 2 automatic repair attempts).",
      repairAttemptsUsed: 2,
      repairSummaries: [
        "Added the missing null check in checkout.ts.",
        "Updated the snapshot the new branch invalidated.",
      ],
      repairPaths: ["src/checkout.ts"],
    });

    /*
     * The body above this section describes the FIRST agent pass only — a
     * reviewer reading it must still be told what the repair passes changed.
     */
    expect(section).toContain("**Repair passes**");
    expect(section).toContain(
      "1. Added the missing null check in checkout.ts.",
    );
    expect(section).toContain(
      "2. Updated the snapshot the new branch invalidated.",
    );
  });

  test("Failed after a repair still lists the repair passes", () => {
    const section: string = BuildVerification.buildPullRequestBodySection({
      status: FixVerificationStatus.Failed,
      summary: "The test command still failed after 1 repair attempt.",
      repairAttemptsUsed: 1,
      repairSummaries: ["Rewrote the failing assertion helper."],
      repairPaths: ["src/checkout.ts"],
      failedCommand: { label: "test", command: "npm test" },
      outputTail: "1 test failed",
    });

    expect(section).toContain("## ⚠️ Verification failed");
    expect(section).toContain("**Repair passes**");
    expect(section).toContain("1. Rewrote the failing assertion helper.");
    // The repair list sits above the failing-output details block.
    expect(section.indexOf("**Repair passes**")).toBeLessThan(
      section.indexOf("<details>"),
    );
  });

  test("Skipped renders the ℹ️ section pointing at repository configuration", async () => {
    // Use the REAL Skipped outcome so the wording asserted is the shipped one.
    const outcome: VerificationOutcome =
      await BuildVerification.verifyWithRepairs({
        repo: buildRepo({}),
        repositoryPath: makeRepoDir(),
        agent: agentThatMustNotBeCalled(),
        originalPrompt: "Fix the bug.",
        log,
      });

    const section: string =
      BuildVerification.buildPullRequestBodySection(outcome);

    expect(section).toContain("## ℹ️ Verification");
    expect(section).toContain("Configure them on the code repository");
  });
});

/*
 * The staging half of the same fix: BuildVerification decides WHICH paths are
 * the fix, RepositoryManager.addPaths is what puts exactly those — and nothing
 * the build emitted — into the commit.
 */
describe("RepositoryManager.addPaths", () => {
  test("stages only the named paths: other dirty files stay out of the commit", async () => {
    const dir: string = makeGitRepoDir();

    fs.writeFileSync(
      path.join(dir, "agent-change.ts"),
      "export const changed: boolean = true;\n",
    );
    // What the repository's own build/test commands left behind.
    fs.writeFileSync(path.join(dir, "build-artifact.log"), "noise\n");
    // A tracked file dirtied by the same commands — `git add -A` would take it.
    fs.appendFileSync(path.join(dir, "README.md"), "touched by the build\n");

    await new RepositoryManager().addPaths(dir, ["agent-change.ts"]);

    expect(stagedPaths(dir)).toEqual(["agent-change.ts"]);
  });

  test("dedupes, skips blank entries, and passes paths after --", async () => {
    const executeSpy: jest.SpyInstance = jest
      .spyOn(Execute, "executeCommandFile")
      .mockResolvedValue("");

    try {
      await new RepositoryManager().addPaths("/repo", [
        "src/fix.ts",
        "src/fix.ts",
        "   ",
        "",
        "src/other.ts",
      ]);

      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(executeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "git",
          // "--" so a path can never be read as a flag.
          args: ["add", "--", "src/fix.ts", "src/other.ts"],
        }),
      );
    } finally {
      executeSpy.mockRestore();
    }
  });

  test("an empty or all-blank path list runs no git command at all", async () => {
    const executeSpy: jest.SpyInstance = jest
      .spyOn(Execute, "executeCommandFile")
      .mockResolvedValue("");

    try {
      await new RepositoryManager().addPaths("/repo", []);
      await new RepositoryManager().addPaths("/repo", ["", "   ", "\n"]);

      // `git add --` with no pathspec would stage nothing but still be noise.
      expect(executeSpy).not.toHaveBeenCalled();
    } finally {
      executeSpy.mockRestore();
    }
  });
});

/*
 * runsVerification / verificationSkippedMessage are protected — this is the
 * typed seam the tests read them through, the same idiom the task-handler
 * tests use for the private processRepository.
 */
interface VerificationOptOutSeam {
  runsVerification: boolean;
  verificationSkippedMessage: string;
}

describe("verification opt-out on the task handlers", () => {
  test("WriteRegressionTest opts OUT, and says why a red suite is the point", () => {
    const handler: VerificationOptOutSeam =
      new WriteRegressionTestTaskHandler() as unknown as VerificationOptOutSeam;

    /*
     * Verifying this recipe would hand the agent a "make the tests pass"
     * repair prompt — destroying the failing test the task exists to write.
     */
    expect(handler.runsVerification).toBe(false);
    expect(handler.verificationSkippedMessage).toContain("EXPECTED to fail");
    expect(handler.verificationSkippedMessage).toContain("regression test");

    // The opt-out message is what the pull request states instead.
    expect(
      BuildVerification.buildPullRequestBodySection({
        status: FixVerificationStatus.Skipped,
        summary: handler.verificationSkippedMessage,
        repairAttemptsUsed: 0,
        repairSummaries: [],
        repairPaths: [],
      }),
    ).toContain("EXPECTED to fail");
  });

  test("FixException keeps the default: it IS verified before the PR opens", () => {
    const handler: VerificationOptOutSeam =
      new FixExceptionTaskHandler() as unknown as VerificationOptOutSeam;

    expect(handler.runsVerification).toBe(true);
  });
});
