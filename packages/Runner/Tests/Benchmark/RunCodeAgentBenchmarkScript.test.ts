/*
 * ---------------------------------------------------------------------------
 * `npm run benchmark` (Scripts/RunCodeAgentBenchmark.ts and
 * Benchmark/CodeAgentBenchmarkCommandLine, issue #6531) spends real AI
 * credits, so it runs only when asked: without the model's key it skips and
 * exits 0 - a CI job a maintainer has not given the key to stays green -
 * and with --require-key it fails, saying where the key goes. It never
 * takes a key as an argument. No model is called: the tasks it would run
 * are handed to a stand-in.
 * ---------------------------------------------------------------------------
 */

import {
  CodeAgentBenchmarkEnding,
  CodeAgentBenchmarkRow,
} from "../../Benchmark/CodeAgentBenchmark";
import {
  CodeAgentBenchmarkRunOptions,
  NO_KEY_MESSAGE,
  hasModelToCall,
  runCodeAgentBenchmark,
} from "../../Benchmark/CodeAgentBenchmarkCommandLine";
import {
  CODE_AGENT_BENCHMARK_TASKS,
  CodeAgentBenchmarkTask,
} from "../../Benchmark/CodeAgentBenchmarkTasks";
import { EvalUsageError } from "Common/Server/Utils/AI/Eval/EvalCommandLine";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

jest.setTimeout(300000);

const RUNNER_ROOT: string = path.join(__dirname, "../..");

interface Ran {
  exitCode: number;
  printed: string;
  tasksRun: Array<string>;
  calls: Array<
    Parameters<NonNullable<CodeAgentBenchmarkRunOptions["runTask"]>>[0]
  >;
  outputPath: string;
}

async function run(
  argv: Array<string>,
  env: Record<string, string | undefined> = {},
  passed: (task: CodeAgentBenchmarkTask) => boolean = (): boolean => {
    return true;
  },
): Promise<Ran> {
  const lines: Array<string> = [];
  const calls: Ran["calls"] = [];
  const outputPath: string = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-benchmark-cli-")),
    "results.json",
  );

  const exitCode: number = await runCodeAgentBenchmark({
    argv,
    env,
    outputPath,
    print: (printed: Array<string>): void => {
      lines.push(...printed);
    },
    runTask: async (
      data: Ran["calls"][number],
    ): Promise<CodeAgentBenchmarkRow> => {
      calls.push(data);

      return {
        taskId: data.task.id,
        shape: data.task.shape,
        passed: passed(data.task),
        ending: CodeAgentBenchmarkEnding.Answer,
        rounds: 4,
        toolCalls: { read_file: 2, edit_file: 1 },
        promptTokens: 4_000,
        completionTokens: 400,
        totalTokens: 4_400,
        durationSeconds: 65,
        checkDetail: passed(data.task) ? "" : "still broken",
        error: null,
        summary: "Did it.",
      };
    },
  });

  return {
    exitCode,
    printed: lines.join("\n"),
    tasksRun: calls.map((call: Ran["calls"][number]): string => {
      return call.task.id;
    }),
    calls,
    outputPath,
  };
}

describe("without the model's key", () => {
  test("it skips, exits 0, says why, and runs no task", async () => {
    const ran: Ran = await run(["--llm-type=Anthropic", "--model=x"]);

    expect(ran.exitCode).toBe(0);
    expect(ran.printed).toBe(`Skipped. ${NO_KEY_MESSAGE}`);
    expect(NO_KEY_MESSAGE).toBe(
      "No AI_EVAL_LLM_API_KEY: the code agent benchmark calls a real model and spends real AI credits, so it runs only with the model's key in AI_EVAL_LLM_API_KEY.",
    );
    expect(ran.tasksRun).toEqual([]);
    expect(fs.existsSync(ran.outputPath)).toBe(false);
  });

  test("it skips with nothing else given, too: a CI job with no key and no model", async () => {
    expect((await run([])).exitCode).toBe(0);
  });

  test("an empty key is no key", async () => {
    expect(
      (await run(["--llm-type=OpenAI"], { AI_EVAL_LLM_API_KEY: "  " })).printed,
    ).toContain("Skipped.");
  });

  test("with --require-key it fails, saying where the key goes", async () => {
    await expect(run(["--llm-type=OpenAI", "--require-key"])).rejects.toThrow(
      new EvalUsageError(NO_KEY_MESSAGE),
    );
  });

  test("a model you run yourself needs none", () => {
    expect(hasModelToCall(["--llm-type=Ollama"], {})).toBe(true);
    expect(hasModelToCall(["--llm-type=openaicompatible"], {})).toBe(true);
    expect(hasModelToCall(["--llm-type=Anthropic"], {})).toBe(false);
    expect(
      hasModelToCall(["--llm-type=Anthropic"], { AI_EVAL_LLM_API_KEY: "k" }),
    ).toBe(true);
  });
});

describe("with the model's key", () => {
  const KEY: Record<string, string> = { AI_EVAL_LLM_API_KEY: "test-key" };

  test("it runs every task with the time limits asked for, and writes and prints one row a task", async () => {
    const ran: Ran = await run(
      [
        "--llm-type=Anthropic",
        "--model=claude-opus-5-5",
        "--time-limit=45",
        "--command-time-limit=20",
      ],
      KEY,
    );

    expect(ran.exitCode).toBe(0);
    expect(ran.tasksRun).toEqual(
      CODE_AGENT_BENCHMARK_TASKS.map((task: CodeAgentBenchmarkTask) => {
        return task.id;
      }),
    );
    expect(ran.calls[0]!.timeLimitInMinutes).toBe(45);
    expect(ran.calls[0]!.commandTimeLimitInMinutes).toBe(20);
    expect(ran.calls[0]!.model.llmType).toBe("Anthropic");
    expect(ran.calls[0]!.model.modelName).toBe("claude-opus-5-5");

    const rows: Array<CodeAgentBenchmarkRow> = JSON.parse(
      fs.readFileSync(ran.outputPath, "utf8"),
    );

    expect(rows).toHaveLength(CODE_AGENT_BENCHMARK_TASKS.length);
    expect(ran.printed).toContain(
      "| Task | Shape | Check | Ended | Rounds | Tool calls | Tokens | Time |",
    );
    expect(ran.printed).toContain(
      `Passed ${CODE_AGENT_BENCHMARK_TASKS.length} of ${CODE_AGENT_BENCHMARK_TASKS.length}.`,
    );
    expect(ran.printed).toContain("command time limit: 20 minutes");
    expect(ran.printed).not.toContain("test-key");
  });

  test("the time limits default to 30 minutes a task, and the project default a command", async () => {
    const ran: Ran = await run(["--llm-type=Anthropic"], KEY);

    expect(ran.calls[0]!.timeLimitInMinutes).toBe(30);
    expect(ran.calls[0]!.commandTimeLimitInMinutes).toBeUndefined();
    expect(ran.printed).toContain("command time limit: 10 minutes");
  });

  test("--task runs only those tasks, and an unknown one is a usage error", async () => {
    const one: string = CODE_AGENT_BENCHMARK_TASKS[1]!.id;

    expect(
      (await run(["--llm-type=Anthropic", `--task=${one}`], KEY)).tasksRun,
    ).toEqual([one]);
    await expect(
      run(["--llm-type=Anthropic", "--task=no-such-task"], KEY),
    ).rejects.toThrow(
      "Unknown task(s): no-such-task. Run with --list to see them.",
    );
  });

  test("--fail-under fails the run when fewer tasks pass", async () => {
    const ran: Ran = await run(
      [
        "--llm-type=Anthropic",
        `--fail-under=${CODE_AGENT_BENCHMARK_TASKS.length}`,
      ],
      KEY,
      (task: CodeAgentBenchmarkTask): boolean => {
        return task.id !== CODE_AGENT_BENCHMARK_TASKS[0]!.id;
      },
    );

    expect(ran.exitCode).toBe(1);
    expect(ran.printed).toContain(
      `Fewer tasks passed (${CODE_AGENT_BENCHMARK_TASKS.length - 1}) than --fail-under=${CODE_AGENT_BENCHMARK_TASKS.length}.`,
    );
    expect(ran.printed).toContain("failed (still broken)");
  });

  test.each([
    ["--time-limit=0", "--time-limit must be a whole number from 1 to 1440"],
    [
      "--command-time-limit=121",
      "--command-time-limit must be a whole number from 1 to 120",
    ],
    ["--fail-under=x", "--fail-under must be a whole number from 0 to"],
  ])("%s is a usage error", async (arg: string, message: string) => {
    await expect(run(["--llm-type=Anthropic", arg], KEY)).rejects.toThrow(
      message,
    );
  });

  test("a key given as an argument is refused: it would stay in the shell's history", async () => {
    await expect(
      run(["--llm-type=Anthropic", "--api-key=sk-not-here"], KEY),
    ).rejects.toThrow(
      "Pass the API key in the AI_EVAL_LLM_API_KEY environment variable, not as --api-key",
    );
  });
});

describe("--list", () => {
  test("lists every task, and runs nothing", async () => {
    const ran: Ran = await run(["--list"]);

    expect(ran.exitCode).toBe(0);
    expect(ran.tasksRun).toEqual([]);

    for (const task of CODE_AGENT_BENCHMARK_TASKS) {
      expect(ran.printed).toContain(task.id);
    }
  });
});

/*
 * The script as npm runs it, once: with no key in its environment it
 * loads, skips, and exits 0.
 */
describe("npm run benchmark", () => {
  test("is the package's benchmark script, with the Runner settings its imports need", () => {
    const scripts: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(RUNNER_ROOT, "package.json"), "utf8"),
    ).scripts;

    expect(scripts["benchmark"]).toBe(
      "ONEUPTIME_URL=http://code-agent-benchmark.invalid ONEUPTIME_RUNNER_ID=00000000-0000-4000-8000-000000000000 ONEUPTIME_RUNNER_KEY=code-agent-benchmark ts-node Scripts/RunCodeAgentBenchmark.ts",
    );
  });

  test("without a key, the script skips and exits 0", () => {
    const environment: NodeJS.ProcessEnv = { ...process.env };

    delete environment["AI_EVAL_LLM_API_KEY"];

    const result: SpawnSyncReturns<string> = spawnSync(
      process.execPath,
      [
        "--require",
        "ts-node/register",
        "Scripts/RunCodeAgentBenchmark.ts",
        "--llm-type=Anthropic",
      ],
      {
        cwd: RUNNER_ROOT,
        encoding: "utf8",
        env: {
          ...environment,
          ONEUPTIME_URL: "http://code-agent-benchmark.invalid",
          ONEUPTIME_RUNNER_ID: "00000000-0000-4000-8000-000000000000",
          ONEUPTIME_RUNNER_KEY: "code-agent-benchmark",
          TS_NODE_TRANSPILE_ONLY: "true",
        },
        timeout: 240_000,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Skipped. ${NO_KEY_MESSAGE}`);
  });
});
