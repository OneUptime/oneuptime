import { CodeAgentResult } from "../CodeAgents/CodeAgentInterface";
import InHouseCodeAgent from "../CodeAgents/InHouseCodeAgent";
import CodeAgentBenchmarkServer, {
  CodeAgentBenchmarkModel,
  CodeAgentBenchmarkUsage,
} from "./CodeAgentBenchmarkServer";
import {
  CodeAgentBenchmarkCheck,
  CodeAgentBenchmarkTask,
} from "./CodeAgentBenchmarkTasks";
import AIAgentRunLimitsHelper, {
  AIRunStopReason,
} from "Common/Types/AI/AIAgentRunLimits";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The code agent benchmark (issue #6531): the real in-house agent
 * (InHouseCodeAgent) - its prompt, its tools, its loop and its limits - on
 * each task's repository, with the model named on the command line, and the
 * task's check on what it left. One row a task:
 *
 *   - whether the check passed;
 *   - how the run ended: its answer, a loop stop, its time limit, or an
 *     error;
 *   - its model calls (rounds), the tool calls by tool, its tokens and its
 *     time.
 *
 * The model is called directly (CodeAgentBenchmarkServer): no OneUptime
 * server, no project, nothing billed but the model's own provider. The
 * agent's commands run on this machine, in a temporary copy of the task's
 * repository, as they run on a Runner of your own.
 */

export enum CodeAgentBenchmarkEnding {
  Answer = "answer",
  LoopStop = "loop stop",
  TimeLimit = "time limit",
  Error = "error",
}

export interface CodeAgentBenchmarkRow {
  taskId: string;
  shape: string;
  passed: boolean;
  ending: CodeAgentBenchmarkEnding;
  rounds: number;
  toolCalls: Record<string, number>;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationSeconds: number;
  // What the check said when it failed.
  checkDetail: string;
  // The agent's error, when it ended in one.
  error: string | null;
  // What the agent said it did.
  summary: string;
}

export interface CodeAgentBenchmarkSummary {
  taskCount: number;
  passedCount: number;
  endings: Record<string, number>;
  rounds: number;
  toolCalls: number;
  totalTokens: number;
  durationSeconds: number;
}

export default class CodeAgentBenchmark {
  /*
   * The task's repository, written into a new temporary folder and
   * committed, as a Runner clones one: the agent's git tool and its change
   * set read it as a repository.
   */
  public static prepareRepository(task: CodeAgentBenchmarkTask): string {
    const directory: string = fs.realpathSync(
      fs.mkdtempSync(
        path.join(os.tmpdir(), `oneuptime-code-benchmark-${task.id}-`),
      ),
    );

    for (const [relative, content] of Object.entries(task.files())) {
      const full: string = path.join(directory, relative);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }

    const git: (args: Array<string>) => void = (args: Array<string>): void => {
      execFileSync("git", args, { cwd: directory, stdio: "ignore" });
    };

    git(["init", "-q", "-b", "main", "."]);
    git(["config", "user.email", "benchmark@oneuptime.com"]);
    git(["config", "user.name", "OneUptime Benchmark"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "The repository as the task finds it"]);

    return directory;
  }

  /*
   * One task, start to end: its repository, the agent with the model on
   * it, the check, and the row. The repository is removed after, unless
   * `keepRepository` (to read what the agent left).
   */
  public static async runTask(data: {
    task: CodeAgentBenchmarkTask;
    model: CodeAgentBenchmarkModel;
    timeLimitInMinutes: number;
    commandTimeLimitInMinutes?: number | undefined;
    keepRepository?: boolean | undefined;
    // The server's clock (the tests move it on).
    now?: (() => number) | undefined;
  }): Promise<CodeAgentBenchmarkRow> {
    const repositoryPath: string = this.prepareRepository(data.task);
    const server: CodeAgentBenchmarkServer = new CodeAgentBenchmarkServer({
      model: data.model,
      timeLimitInMinutes: data.timeLimitInMinutes,
      commandTimeLimitInMinutes: data.commandTimeLimitInMinutes,
      now: data.now,
    });
    const agent: InHouseCodeAgent = new InHouseCodeAgent({ server });
    const startedAtMs: number = Date.now();

    try {
      await agent.initialize({ taskId: `benchmark-${data.task.id}` });

      let result: CodeAgentResult;

      try {
        result = await agent.executeTask({
          workingDirectory: repositoryPath,
          prompt: data.task.prompt,
        });
      } catch (error) {
        result = {
          success: false,
          filesModified: [],
          summary: "",
          logs: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }

      const durationSeconds: number = Math.round(
        (Date.now() - startedAtMs) / 1000,
      );
      const check: CodeAgentBenchmarkCheck =
        await data.task.check(repositoryPath);

      return this.toRow({
        task: data.task,
        result,
        check,
        usage: server.usage,
        stopNotes: this.getStopNotes(server),
        durationSeconds,
      });
    } finally {
      await agent.cleanup();

      if (!data.keepRepository) {
        fs.rmSync(repositoryPath, { recursive: true, force: true });
      }
    }
  }

  // The row of a task the agent ran: pure, for the tests.
  public static toRow(data: {
    task: CodeAgentBenchmarkTask;
    result: CodeAgentResult;
    check: CodeAgentBenchmarkCheck;
    usage: CodeAgentBenchmarkUsage;
    stopNotes: Partial<Record<CodeAgentBenchmarkEnding, string>>;
    durationSeconds: number;
  }): CodeAgentBenchmarkRow {
    return {
      taskId: data.task.id,
      shape: data.task.shape,
      passed: data.check.passed,
      ending: this.getEnding(data.result, data.stopNotes),
      rounds: data.usage.modelCalls,
      toolCalls: { ...data.usage.toolCalls },
      promptTokens: data.usage.promptTokens,
      completionTokens: data.usage.completionTokens,
      totalTokens: data.usage.totalTokens,
      durationSeconds: data.durationSeconds,
      checkDetail: data.check.passed ? "" : data.check.detail,
      error: data.result.success ? null : data.result.error || "unknown error",
      summary: data.result.summary || "",
    };
  }

  /*
   * How a run ended: an error when the agent failed; a loop stop or the
   * time limit when its summary ends with that stop's note, as the agent
   * writes it under a summary a limit cut short; its answer otherwise.
   */
  public static getEnding(
    result: CodeAgentResult,
    stopNotes: Partial<Record<CodeAgentBenchmarkEnding, string>>,
  ): CodeAgentBenchmarkEnding {
    if (!result.success) {
      return CodeAgentBenchmarkEnding.Error;
    }

    for (const ending of [
      CodeAgentBenchmarkEnding.LoopStop,
      CodeAgentBenchmarkEnding.TimeLimit,
    ]) {
      const note: string | undefined = stopNotes[ending];

      if (note && (result.summary || "").includes(note)) {
        return ending;
      }
    }

    return CodeAgentBenchmarkEnding.Answer;
  }

  // The notes the agent ends a summary with when a loop or the time stopped it.
  public static getStopNotes(
    server: CodeAgentBenchmarkServer,
  ): Partial<Record<CodeAgentBenchmarkEnding, string>> {
    return {
      [CodeAgentBenchmarkEnding.LoopStop]: AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.Loop,
        limits: server.getAgentRunLimits(),
      }),
      [CodeAgentBenchmarkEnding.TimeLimit]: AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.TimeLimit,
        limits: server.getAgentRunLimits(),
      }),
    };
  }

  public static summarize(
    rows: Array<CodeAgentBenchmarkRow>,
  ): CodeAgentBenchmarkSummary {
    const endings: Record<string, number> = {};

    for (const row of rows) {
      endings[row.ending] = (endings[row.ending] || 0) + 1;
    }

    return {
      taskCount: rows.length,
      passedCount: rows.filter((row: CodeAgentBenchmarkRow): boolean => {
        return row.passed;
      }).length,
      endings,
      rounds: this.sum(rows, (row: CodeAgentBenchmarkRow): number => {
        return row.rounds;
      }),
      toolCalls: this.sum(rows, (row: CodeAgentBenchmarkRow): number => {
        return this.countToolCalls(row);
      }),
      totalTokens: this.sum(rows, (row: CodeAgentBenchmarkRow): number => {
        return row.totalTokens;
      }),
      durationSeconds: this.sum(rows, (row: CodeAgentBenchmarkRow): number => {
        return row.durationSeconds;
      }),
    };
  }

  /*
   * The report's table, one row a task, in Markdown - it reads in a
   * terminal, and pastes into an issue as it is.
   */
  public static formatTable(rows: Array<CodeAgentBenchmarkRow>): Array<string> {
    const lines: Array<string> = [
      "| Task | Shape | Check | Ended | Rounds | Tool calls | Tokens | Time |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ];

    for (const row of rows) {
      lines.push(
        `| ${row.taskId} | ${row.shape} | ${row.passed ? "passed" : "failed"} | ${row.ending} | ${row.rounds} | ${this.describeToolCalls(row)} | ${row.totalTokens.toLocaleString("en-US")} | ${this.describeDuration(row.durationSeconds)} |`,
      );
    }

    return lines;
  }

  // "12 (read_file 6, run_command 3, edit_file 3)", the most-used first.
  public static describeToolCalls(row: CodeAgentBenchmarkRow): string {
    const entries: Array<[string, number]> = Object.entries(row.toolCalls).sort(
      (a: [string, number], b: [string, number]): number => {
        return b[1] - a[1] || a[0].localeCompare(b[0]);
      },
    );

    if (entries.length === 0) {
      return "0";
    }

    return `${this.countToolCalls(row)} (${entries
      .map((entry: [string, number]): string => {
        return `${entry[0]} ${entry[1]}`;
      })
      .join(", ")})`;
  }

  public static describeDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }

    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  }

  private static countToolCalls(row: CodeAgentBenchmarkRow): number {
    return Object.values(row.toolCalls).reduce(
      (total: number, count: number): number => {
        return total + count;
      },
      0,
    );
  }

  private static sum(
    rows: Array<CodeAgentBenchmarkRow>,
    of: (row: CodeAgentBenchmarkRow) => number,
  ): number {
    return rows.reduce((total: number, row: CodeAgentBenchmarkRow): number => {
      return total + of(row);
    }, 0);
  }
}
