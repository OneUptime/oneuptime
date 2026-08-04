import { spawn } from "child_process";
import FixVerificationStatus from "Common/Types/AI/FixVerificationStatus";
import { CodeAgent, CodeAgentResult } from "../CodeAgents/Index";
import { CodeRepositoryInfo } from "./BackendAPI";
import logger from "Common/Server/Utils/Logger";

/*
 * The pre-PR build/test verification loop ("tests green before the PR").
 *
 * After the code agent finishes its changes — and BEFORE anything is
 * committed or pushed — the operator-configured commands on the repository
 * (setupCommand, buildCommand, testCommand) run at the repository root, on
 * this Runner, in the cloned workspace. A failure is fed back to the SAME
 * code agent as a repair task (bounded attempts, sharing the run's
 * server-enforced LLM budget), and the commands re-run after each repair.
 *
 * The loop never blocks the pull request: a fix that still fails
 * verification opens as a clearly-labeled draft PR — the work is preserved
 * and the human reviewer decides. Repositories with no commands configured
 * are Skipped, stated honestly on the PR instead of implying a green build.
 *
 * Trust model: the commands are operator-authored repository configuration
 * executed on the operator's own Runner (the same posture as runbook Bash
 * steps) — they are configuration, not AI output, and are never composed by
 * the model.
 */

/*
 * Per-command wall clock. Builds and test suites are slow; be generous —
 * but the whole verification pass must stay inside the server's stale-run
 * sweeper window (RUN_HEARTBEAT_TIMEOUT_MINUTES = 12 in
 * App/FeatureSet/Workers/Jobs/AIChat/TimeoutStuckRuns.ts), which finalizes
 * a Running code-fix run as Error once its heartbeat goes quiet. Commands
 * emit no output of their own on the run, so HEARTBEAT_INTERVAL_MS below
 * is what actually keeps the run alive; this timeout only bounds a single
 * hung command.
 */
export const VERIFICATION_COMMAND_TIMEOUT_MS: number = 15 * 60 * 1000;

/*
 * How often a still-running command reports progress. Must be comfortably
 * under the sweeper's 12-minute heartbeat timeout: a code-fix run is only
 * kept alive by LLM completions and task-log posts, and a build/test
 * command makes neither, so without this a long command lets the server
 * finalize the run as Error while this Runner keeps working and still
 * opens the pull request.
 */
export const HEARTBEAT_INTERVAL_MS: number = 2 * 60 * 1000;

/*
 * How many times a failing verification is handed back to the code agent
 * for a repair before the loop gives up and labels the PR as failed.
 */
export const MAX_REPAIR_ATTEMPTS: number = 2;

/*
 * How much combined command output is kept: the TAIL is what carries
 * compiler errors and test failures, and it must fit in a repair prompt.
 */
const OUTPUT_TAIL_CHARS: number = 8000;

/*
 * How long "exit" waits for the stdio pipes to drain before settling anyway.
 * Long enough that a loaded runner still delivers the last chunk, short enough
 * that a grandchild holding the pipes open costs a fraction of a second.
 */
const STDIO_DRAIN_GRACE_MS: number = 500;

// Wall clock granted to each agent repair pass.
const REPAIR_AGENT_TIMEOUT_MS: number = 15 * 60 * 1000;

/*
 * Secret scrubbing for captured command output. The output tail travels to
 * three places that outlive this process — the repair prompt, the pull
 * request body on GitHub, and the recorded verification summary — so it is
 * redacted once at capture, where it is the only copy.
 *
 * Build commands inherit this Runner's environment (they need registry and
 * toolchain credentials to work at all), which also carries the Runner's
 * own ONEUPTIME_RUNNER_KEY. A command that echoes its environment — `env`,
 * `set -x`, a failing curl, a test that dumps config — would otherwise
 * publish those values verbatim.
 */
const NON_SECRET_ENV_NAMES: Set<string> = new Set<string>([
  "PATH",
  "HOME",
  "PWD",
  "OLDPWD",
  "SHELL",
  "SHLVL",
  "TERM",
  "LANG",
  "LC_ALL",
  "HOSTNAME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "NODE_ENV",
  "CI",
  "_",
]);

/*
 * Values shorter than this are too collision-prone to blanket-replace (a
 * 3-character value would shred unrelated output).
 */
const MIN_SECRET_VALUE_LENGTH: number = 8;

export interface VerificationCommand {
  // Which repository field the command came from.
  label: "setup" | "build" | "test";
  command: string;
}

export interface CommandRunResult {
  passed: boolean;
  failedCommand?: VerificationCommand | undefined;
  // Combined stdout+stderr tail of the FAILED command.
  outputTail?: string | undefined;
}

export interface VerificationOutcome {
  status: FixVerificationStatus;
  // One-paragraph human-readable summary for the record + PR body.
  summary: string;
  repairAttemptsUsed: number;
  /*
   * What each successful repair pass reported changing. The pull-request
   * body otherwise describes only the FIRST agent pass, while the branch
   * also carries every repair edit — a description that does not match the
   * diff a reviewer is reading.
   */
  repairSummaries: Array<string>;
  /*
   * Paths the repair passes introduced, measured against the tree as it
   * stood after the verification commands ran. The caller stages exactly
   * these (plus the agent's own pre-verification paths) instead of
   * `git add -A`, so command output never lands in the pull request.
   */
  repairPaths: Array<string>;
  // Set when status is Failed.
  failedCommand?: VerificationCommand | undefined;
  outputTail?: string | undefined;
}

export default class BuildVerification {
  // The commands a repository has configured, in execution order.
  public static commandsForRepository(
    repo: Pick<
      CodeRepositoryInfo,
      "setupCommand" | "buildCommand" | "testCommand"
    >,
  ): Array<VerificationCommand> {
    const commands: Array<VerificationCommand> = [];

    if (repo.setupCommand?.trim()) {
      commands.push({ label: "setup", command: repo.setupCommand.trim() });
    }
    if (repo.buildCommand?.trim()) {
      commands.push({ label: "build", command: repo.buildCommand.trim() });
    }
    if (repo.testCommand?.trim()) {
      commands.push({ label: "test", command: repo.testCommand.trim() });
    }

    return commands;
  }

  /*
   * Redact this process's secret-looking environment values out of captured
   * output. Applied at capture, so the redacted text is the only copy that
   * reaches the repair prompt, the pull-request body and the recorded
   * summary. Longest values first: an env var whose value contains another
   * must not be half-replaced.
   */
  public static redactSecrets(text: string): string {
    let redacted: string = text;

    const secrets: Array<{ name: string; value: string }> = Object.entries(
      process.env,
    )
      .filter(([name, value]: [string, string | undefined]) => {
        return (
          typeof value === "string" &&
          value.length >= MIN_SECRET_VALUE_LENGTH &&
          !NON_SECRET_ENV_NAMES.has(name)
        );
      })
      .map(([name, value]: [string, string | undefined]) => {
        return { name, value: value as string };
      })
      .sort((a: { value: string }, b: { value: string }) => {
        return b.value.length - a.value.length;
      });

    for (const secret of secrets) {
      if (!redacted.includes(secret.value)) {
        continue;
      }

      redacted = redacted.split(secret.value).join(`[redacted:${secret.name}]`);
    }

    return redacted;
  }

  /*
   * Run one shell command at the repository root, capturing a bounded tail
   * of combined output. Resolves (never rejects) with pass/fail — a spawn
   * failure or timeout is a failure with the reason in the tail.
   *
   * Three details are load-bearing and easy to regress:
   *   - detached: the command gets its own process group, and the timeout
   *     kills the GROUP. `npm test` spawns the real work in grandchildren;
   *     signalling only the direct child leaves them running.
   *   - "exit" starts a short grace period rather than settling outright:
   *     surviving grandchildren inherit the stdio pipes, so "close" (which
   *     waits for stream EOF) may never fire, but "exit" on its own can beat
   *     the last "data" event. Whichever lands first wins, and a settle guard
   *     keeps it authoritative.
   *   - stdin is /dev/null: a command that reads stdin gets EOF and fails
   *     fast instead of blocking for the entire timeout. CI=true only helps
   *     tools that honor it.
   */
  public static async runCommand(data: {
    command: VerificationCommand;
    repositoryPath: string;
    onOutput?: ((chunk: string) => void) | undefined;
  }): Promise<CommandRunResult> {
    return new Promise<CommandRunResult>(
      (resolve: (result: CommandRunResult) => void) => {
        let outputTail: string = "";
        let settled: boolean = false;
        let timedOut: boolean = false;

        const appendOutput: (chunk: Buffer | string) => void = (
          chunk: Buffer | string,
        ): void => {
          const text: string = BuildVerification.redactSecrets(
            chunk.toString(),
          );
          data.onOutput?.(text);
          outputTail = (outputTail + text).slice(-OUTPUT_TAIL_CHARS);
        };

        const child: ReturnType<typeof spawn> = spawn(
          "bash",
          ["-c", data.command.command],
          {
            cwd: data.repositoryPath,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
              ...process.env,
              // Verification must never sit on an interactive prompt.
              CI: "true",
            },
          },
        );

        const killProcessGroup: () => void = (): void => {
          if (child.pid === undefined) {
            return;
          }

          try {
            // Negative pid targets the whole group (detached above).
            process.kill(-child.pid, "SIGKILL");
          } catch {
            // Already gone, or the group outlived our permission to signal.
            try {
              child.kill("SIGKILL");
            } catch {
              // Nothing left to kill.
            }
          }
        };

        const timer: NodeJS.Timeout = setTimeout(() => {
          timedOut = true;
          killProcessGroup();
        }, VERIFICATION_COMMAND_TIMEOUT_MS);

        // Set once "exit" has landed but the stdio pipes have not drained yet.
        let drainTimer: NodeJS.Timeout | undefined = undefined;

        const settle: (result: CommandRunResult) => void = (
          result: CommandRunResult,
        ): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (drainTimer) {
            clearTimeout(drainTimer);
          }
          resolve(result);
        };

        child.stdout?.on("data", appendOutput);
        child.stderr?.on("data", appendOutput);

        child.on("error", (error: Error) => {
          settle({
            passed: false,
            failedCommand: data.command,
            outputTail: `Failed to start the ${data.command.label} command: ${error.message}`,
          });
        });

        /*
         * "exit" fires when the direct child ends, even if grandchildren still
         * hold the stdio pipes open. Killing the group above means the
         * surviving work is already being torn down, and settling on "exit"
         * stops one runaway daemon from hanging the whole fix run.
         *
         * But "exit" alone loses output. A command that writes a short line and
         * exits at once — `echo compile blew up; exit 7` — routinely delivers
         * its "data" event AFTER "exit", so the tail ends up holding only the
         * exit-code note and none of the error that explains the failure. (Big
         * writes hide this: they fill the pipe and flush long before exit.)
         * "close" is the event that means the pipes are drained, so wait for
         * it — but only briefly, because a lingering grandchild means it may
         * never arrive at all.
         */
        let exitOutcome: { code: number | null; signal: string | null } | null =
          null;
        let stdioClosed: boolean = false;

        const settleFromExit: () => void = (): void => {
          if (!exitOutcome) {
            // "close" beat "exit"; the exit handler will settle.
            return;
          }

          const outcome: { code: number | null; signal: string | null } =
            exitOutcome;

          if (timedOut) {
            settle({
              passed: false,
              failedCommand: data.command,
              outputTail:
                `${outputTail}\n\n(The ${data.command.label} command was killed after exceeding the ` +
                `${Math.round(VERIFICATION_COMMAND_TIMEOUT_MS / 1000)}s verification timeout.)`,
            });
            return;
          }

          if (outcome.code === 0) {
            settle({ passed: true });
            return;
          }

          settle({
            passed: false,
            failedCommand: data.command,
            outputTail:
              `${outputTail}\n\n(The ${data.command.label} command ` +
              (outcome.signal
                ? `was killed by signal ${outcome.signal}.)`
                : `exited with code ${outcome.code}.)`),
          });
        };

        child.on("close", () => {
          stdioClosed = true;
          settleFromExit();
        });

        child.on("exit", (code: number | null, signal: string | null) => {
          exitOutcome = { code, signal };

          if (stdioClosed) {
            settleFromExit();
            return;
          }

          drainTimer = setTimeout(settleFromExit, STDIO_DRAIN_GRACE_MS);
        });
      },
    );
  }

  // Run every configured command in order, stopping at the first failure.
  public static async runCommands(data: {
    commands: Array<VerificationCommand>;
    repositoryPath: string;
    onOutput?: ((chunk: string) => void) | undefined;
  }): Promise<CommandRunResult> {
    for (const command of data.commands) {
      const result: CommandRunResult = await this.runCommand({
        command,
        repositoryPath: data.repositoryPath,
        onOutput: data.onOutput,
      });

      if (!result.passed) {
        return result;
      }
    }

    return { passed: true };
  }

  // The repair prompt handed back to the code agent on a failed verification.
  public static buildRepairPrompt(data: {
    originalPrompt: string;
    failed: CommandRunResult;
  }): string {
    return [
      "Your previous changes in this repository FAILED verification.",
      "",
      `The repository's ${data.failed.failedCommand?.label} command failed:`,
      "```",
      data.failed.failedCommand?.command || "",
      "```",
      "",
      "Output (tail):",
      "```",
      data.failed.outputTail || "(no output captured)",
      "```",
      "",
      "Fix the failure by adjusting YOUR changes (or adding what they are missing).",
      "Do NOT weaken, skip, or delete existing tests to make them pass, and do",
      "not change the verification commands or CI configuration. Stay within",
      "the scope of the original task, restated below for reference:",
      "",
      "---",
      data.originalPrompt,
    ].join("\n");
  }

  /*
   * List every dirty path in the working tree (tracked modifications and
   * untracked files alike), so the caller can tell the agent's edits apart
   * from whatever the repository's own build/test commands emitted.
   * `-uall` lists files inside new directories individually rather than
   * collapsing them to the directory. NUL-delimited so paths containing
   * spaces or quotes survive.
   */
  public static async listDirtyPaths(
    repositoryPath: string,
  ): Promise<Array<string>> {
    return new Promise<Array<string>>(
      (resolve: (paths: Array<string>) => void) => {
        let out: string = "";

        const child: ReturnType<typeof spawn> = spawn(
          "git",
          ["status", "--porcelain", "-uall", "-z"],
          { cwd: repositoryPath, stdio: ["ignore", "pipe", "ignore"] },
        );

        child.stdout?.on("data", (chunk: Buffer) => {
          out += chunk.toString();
        });

        child.on("error", () => {
          resolve([]);
        });

        child.on("close", () => {
          /*
           * Each record is "XY <path>" NUL-terminated. Renames add a second
           * NUL-terminated original path, which we do not need — dropping it
           * is harmless because the new path is already listed.
           */
          const paths: Array<string> = out
            .split("\0")
            .filter((record: string) => {
              return record.length > 3;
            })
            .map((record: string) => {
              return record.substring(3).trim();
            })
            .filter((path: string) => {
              return path.length > 0;
            });

          resolve(paths);
        });
      },
    );
  }

  /*
   * The full verify → repair → re-verify loop. Returns the final outcome;
   * never throws. The agent must already be initialized.
   *
   * Two things the caller depends on:
   *   - `repairPaths` names the files the REPAIR passes touched, computed by
   *     diffing the dirty tree either side of each pass. The caller stages an
   *     explicit pathspec rather than `git add -A`, because by this point the
   *     repository's own commands have run here and their output must not be
   *     committed as part of the fix.
   *   - the run is heartbeated for the whole pass: build and test commands
   *     make no LLM calls and post no logs of their own, and the server
   *     finalizes a code-fix run whose heartbeat is quiet for 12 minutes.
   */
  public static async verifyWithRepairs(data: {
    repo: CodeRepositoryInfo;
    repositoryPath: string;
    agent: CodeAgent;
    originalPrompt: string;
    servicePath?: string | undefined;
    log: (message: string) => Promise<void>;
  }): Promise<VerificationOutcome> {
    const commands: Array<VerificationCommand> = this.commandsForRepository(
      data.repo,
    );

    if (commands.length === 0) {
      return {
        status: FixVerificationStatus.Skipped,
        summary:
          "Not verified — the repository has no setup/build/test commands configured. Configure them on the code repository to have fixes verified before the pull request opens.",
        repairAttemptsUsed: 0,
        repairSummaries: [],
        repairPaths: [],
      };
    }

    const describeCommands: string = commands
      .map((c: VerificationCommand) => {
        return c.label;
      })
      .join(" → ");

    await data.log(
      `Verifying the fix (${describeCommands}) at the repository root...`,
    );

    const repairSummaries: Array<string> = [];
    const repairPaths: Set<string> = new Set<string>();

    /*
     * Keep the run visibly alive while the commands run. A log post is what
     * refreshes lastHeartbeatAt server-side; without this a long build lets
     * the stale-run sweeper finalize the run as Error underneath us.
     */
    const startedAtMs: number = Date.now();
    const heartbeat: NodeJS.Timeout = setInterval(() => {
      const elapsedMinutes: number = Math.round(
        (Date.now() - startedAtMs) / 60000,
      );

      data
        .log(
          `Still verifying (${describeCommands}) — ${elapsedMinutes} minute(s) elapsed...`,
        )
        .catch(() => {
          // A dropped heartbeat must not break the loop.
        });
    }, HEARTBEAT_INTERVAL_MS);

    try {
      let result: CommandRunResult = await this.runCommands({
        commands,
        repositoryPath: data.repositoryPath,
      });

      let repairAttemptsUsed: number = 0;

      while (!result.passed && repairAttemptsUsed < MAX_REPAIR_ATTEMPTS) {
        repairAttemptsUsed += 1;

        await data.log(
          `Verification failed on the ${result.failedCommand?.label} command — asking the code agent to repair (attempt ${repairAttemptsUsed} of ${MAX_REPAIR_ATTEMPTS})...`,
        );

        /*
         * Snapshot AFTER the commands ran and BEFORE the repair agent runs,
         * so command output is already in the baseline and only the agent's
         * own edits come out of the diff below.
         */
        const beforeRepair: Array<string> = await this.listDirtyPaths(
          data.repositoryPath,
        );
        const beforeRepairSet: Set<string> = new Set<string>(beforeRepair);

        let repairResult: CodeAgentResult;
        try {
          repairResult = await data.agent.executeTask({
            workingDirectory: data.repositoryPath,
            prompt: this.buildRepairPrompt({
              originalPrompt: data.originalPrompt,
              failed: result,
            }),
            timeoutMs: REPAIR_AGENT_TIMEOUT_MS,
            ...(data.servicePath ? { servicePath: data.servicePath } : {}),
          });
        } catch (error) {
          logger.error(`Verification repair pass threw: ${error}`);
          break;
        }

        for (const path of await this.listDirtyPaths(data.repositoryPath)) {
          if (!beforeRepairSet.has(path)) {
            repairPaths.add(path);
          }
        }

        /*
         * A failed repair pass (LLM budget exhausted, agent error) cannot
         * improve the tree — stop repairing and report the last verification
         * failure honestly.
         */
        if (!repairResult.success) {
          await data.log(
            `Repair attempt ${repairAttemptsUsed} did not complete: ${repairResult.error || repairResult.summary}`,
          );
          break;
        }

        if (repairResult.summary) {
          repairSummaries.push(repairResult.summary);
        }

        result = await this.runCommands({
          commands,
          repositoryPath: data.repositoryPath,
        });
      }

      if (result.passed) {
        const summary: string = `Verified on the Runner before this pull request opened: ${describeCommands} all passed at the repository root${
          repairAttemptsUsed > 0
            ? ` (after ${repairAttemptsUsed} automatic repair ${
                repairAttemptsUsed === 1 ? "attempt" : "attempts"
              })`
            : ""
        }.`;

        await data.log(`Verification passed (${describeCommands}).`);

        return {
          status: FixVerificationStatus.Passed,
          summary,
          repairAttemptsUsed,
          repairSummaries,
          repairPaths: Array.from(repairPaths),
        };
      }

      /*
       * The recorded summary rides in a varchar(500) column, so bound the
       * interpolated command: a long testCommand would otherwise push the
       * explanation past the cut.
       */
      const shownCommand: string = this.truncateForSummary(
        result.failedCommand?.command || "",
      );

      const summary: string = `Verification FAILED: the ${result.failedCommand?.label} command (\`${shownCommand}\`) still failed after ${repairAttemptsUsed} repair ${
        repairAttemptsUsed === 1 ? "attempt" : "attempts"
      }. The pull request was opened anyway so the work is not lost — review the failure before merging.`;

      await data.log(
        `Verification still failing after ${repairAttemptsUsed} repair attempt(s); opening the PR labeled as failed.`,
      );

      return {
        status: FixVerificationStatus.Failed,
        summary,
        repairAttemptsUsed,
        repairSummaries,
        repairPaths: Array.from(repairPaths),
        failedCommand: result.failedCommand,
        outputTail: result.outputTail,
      };
    } finally {
      clearInterval(heartbeat);
    }
  }

  // Keep an interpolated command short enough for the varchar(500) summary.
  private static truncateForSummary(command: string): string {
    const maxLength: number = 120;

    if (command.length <= maxLength) {
      return command;
    }

    return `${command.substring(0, maxLength - 3)}...`;
  }

  // The PR-body section stating the verification outcome honestly.
  public static buildPullRequestBodySection(
    outcome: VerificationOutcome,
  ): string {
    /*
     * The body above this section describes the FIRST agent pass only. When
     * repairs also edited the branch, say what they changed — otherwise the
     * description does not match the diff under review.
     */
    const repairsBlock: string =
      outcome.repairSummaries.length > 0
        ? `\n\n**Repair passes**\n${outcome.repairSummaries
            .map((summary: string, index: number) => {
              return `\n${index + 1}. ${summary}`;
            })
            .join("")}`
        : "";

    if (outcome.status === FixVerificationStatus.Passed) {
      return `\n\n## ✅ Verification\n\n${outcome.summary}${repairsBlock}`;
    }

    if (outcome.status === FixVerificationStatus.Failed) {
      const outputBlock: string = outcome.outputTail
        ? `\n\n<details><summary>Failing output (tail)</summary>\n\n\`\`\`\n${outcome.outputTail.slice(-3000)}\n\`\`\`\n\n</details>`
        : "";

      return `\n\n## ⚠️ Verification failed\n\n${outcome.summary}${repairsBlock}${outputBlock}`;
    }

    return `\n\n## ℹ️ Verification\n\n${outcome.summary}`;
  }
}
