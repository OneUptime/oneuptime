import CodeAgentBenchmark, {
  CodeAgentBenchmarkRow,
  CodeAgentBenchmarkSummary,
} from "./CodeAgentBenchmark";
import { createProviderModel, needsApiKey } from "./CodeAgentBenchmarkModel";
import { CodeAgentBenchmarkModel } from "./CodeAgentBenchmarkServer";
import {
  CODE_AGENT_BENCHMARK_TASKS,
  CodeAgentBenchmarkTask,
} from "./CodeAgentBenchmarkTasks";
import {
  EvalEnvironment,
  EvalUsageError,
  MODEL_API_KEY_ENV,
  describeModelOptions,
  getArgValue,
  hasFlag,
  parseLlmType,
  readModelOptions,
} from "Common/Server/Utils/AI/Eval/EvalCommandLine";
import { PinnedModelOptions } from "Common/Server/Utils/AI/Eval/PinnedModel";
import {
  DEFAULT_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES,
  MAX_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES,
  MAX_AI_RUN_TIME_LIMIT_IN_MINUTES,
  MIN_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES,
  MIN_AI_RUN_TIME_LIMIT_IN_MINUTES,
} from "Common/Types/AI/AIAgentRunLimits";
import fs from "fs";

/*
 * The code agent benchmark's command line (issue #6531), which
 * Scripts/RunCodeAgentBenchmark.ts runs as `npm run benchmark`:
 *
 *   --llm-type=<type> --model=<name> --base-url=<url>
 *                                  the model under test (EvalCommandLine),
 *                                  its key in AI_EVAL_LLM_API_KEY
 *   --task=<id>[,<id>]             run only these tasks
 *   --time-limit=<minutes>         each task's time limit (30 by default)
 *   --command-time-limit=<minutes> the most one command may run (10 by default)
 *   --fail-under=<n>               exit 1 when fewer than n tasks pass
 *   --keep-repositories            keep each task's repository, to read it
 *   --require-key                  fail rather than skip without a key
 *   --list                         list the tasks and stop
 *
 * It spends real AI credits, so without the model's key it skips and
 * exits 0 - a CI job nobody gave the key to stays green - and fails only
 * with --require-key. A model you run yourself (Ollama, an OpenAI-compatible
 * server) needs no key.
 */

export const CODE_AGENT_BENCHMARK_OUTPUT_PATH: string =
  "./code-agent-benchmark-results.json";

export const DEFAULT_BENCHMARK_TIME_LIMIT_IN_MINUTES: number = 30;

export interface CodeAgentBenchmarkRunOptions {
  argv: ReadonlyArray<string>;
  env: EvalEnvironment;
  print: (lines: Array<string>) => void;
  // Where the rows are written.
  outputPath?: string | undefined;
  // Runs one task: CodeAgentBenchmark.runTask, unless a test says.
  runTask?:
    | ((data: {
        task: CodeAgentBenchmarkTask;
        model: CodeAgentBenchmarkModel;
        timeLimitInMinutes: number;
        commandTimeLimitInMinutes?: number | undefined;
        keepRepository?: boolean | undefined;
      }) => Promise<CodeAgentBenchmarkRow>)
    | undefined;
}

// The skip's sentence, the same in the output and in a --require-key failure.
export const NO_KEY_MESSAGE: string = `No ${MODEL_API_KEY_ENV}: the code agent benchmark calls a real model and spends real AI credits, so it runs only with the model's key in ${MODEL_API_KEY_ENV}.`;

/*
 * Whether the benchmark may call a model: with a key, or for a model you
 * run yourself. Asked before anything else, so a CI job with no key skips
 * cleanly, whatever else it was given.
 */
export function hasModelToCall(
  argv: ReadonlyArray<string>,
  env: EvalEnvironment,
): boolean {
  if ((env[MODEL_API_KEY_ENV] || "").trim()) {
    return true;
  }

  const llmType: string | undefined = getArgValue(argv, "llm-type");

  if (!llmType) {
    return false;
  }

  try {
    return !needsApiKey(parseLlmType(llmType));
  } catch {
    // An unknown type is a usage error, which readModelOptions says.
    return true;
  }
}

export function pickTasks(
  argv: ReadonlyArray<string>,
): Array<CodeAgentBenchmarkTask> {
  const wanted: string | undefined = getArgValue(argv, "task");

  if (!wanted) {
    return [...CODE_AGENT_BENCHMARK_TASKS];
  }

  const ids: Array<string> = wanted
    .split(",")
    .map((id: string): string => {
      return id.trim();
    })
    .filter(Boolean);
  const unknown: Array<string> = ids.filter((id: string): boolean => {
    return !CODE_AGENT_BENCHMARK_TASKS.some(
      (task: CodeAgentBenchmarkTask): boolean => {
        return task.id === id;
      },
    );
  });

  if (unknown.length > 0) {
    throw new EvalUsageError(
      `Unknown task(s): ${unknown.join(", ")}. Run with --list to see them.`,
    );
  }

  return CODE_AGENT_BENCHMARK_TASKS.filter(
    (task: CodeAgentBenchmarkTask): boolean => {
      return ids.includes(task.id);
    },
  );
}

// A whole number argument within its bounds, or its default when not given.
export function readWholeNumber(data: {
  argv: ReadonlyArray<string>;
  name: string;
  min: number;
  max: number;
  defaultValue: number | undefined;
}): number | undefined {
  const value: string | undefined = getArgValue(data.argv, data.name);

  if (value === undefined) {
    return data.defaultValue;
  }

  const parsed: number = Number(value);

  if (
    value.trim() === "" ||
    !Number.isInteger(parsed) ||
    parsed < data.min ||
    parsed > data.max
  ) {
    throw new EvalUsageError(
      `--${data.name} must be a whole number from ${data.min} to ${data.max}, got "${value}".`,
    );
  }

  return parsed;
}

// The benchmark, start to end: its exit code.
export async function runCodeAgentBenchmark(
  options: CodeAgentBenchmarkRunOptions,
): Promise<number> {
  const { argv, env, print } = options;
  const outputPath: string =
    options.outputPath || CODE_AGENT_BENCHMARK_OUTPUT_PATH;

  if (argv.includes("--list")) {
    print(
      CODE_AGENT_BENCHMARK_TASKS.map((task: CodeAgentBenchmarkTask): string => {
        return `${task.id.padEnd(30)} ${task.shape.padEnd(24)} ${task.title}`;
      }),
    );
    return 0;
  }

  if (!hasModelToCall(argv, env)) {
    if (hasFlag(argv, "require-key")) {
      throw new EvalUsageError(NO_KEY_MESSAGE);
    }

    print([`Skipped. ${NO_KEY_MESSAGE}`]);
    return 0;
  }

  const model: PinnedModelOptions = readModelOptions(argv, env);
  const tasks: Array<CodeAgentBenchmarkTask> = pickTasks(argv);
  const timeLimitInMinutes: number = readWholeNumber({
    argv,
    name: "time-limit",
    min: MIN_AI_RUN_TIME_LIMIT_IN_MINUTES,
    max: MAX_AI_RUN_TIME_LIMIT_IN_MINUTES,
    defaultValue: DEFAULT_BENCHMARK_TIME_LIMIT_IN_MINUTES,
  }) as number;
  const commandTimeLimitInMinutes: number | undefined = readWholeNumber({
    argv,
    name: "command-time-limit",
    min: MIN_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES,
    max: MAX_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES,
    defaultValue: undefined,
  });
  const failUnder: number | undefined = readWholeNumber({
    argv,
    name: "fail-under",
    min: 0,
    max: tasks.length,
    defaultValue: undefined,
  });
  const runTask: NonNullable<CodeAgentBenchmarkRunOptions["runTask"]> =
    options.runTask ||
    ((
      data: Parameters<NonNullable<CodeAgentBenchmarkRunOptions["runTask"]>>[0],
    ): Promise<CodeAgentBenchmarkRow> => {
      return CodeAgentBenchmark.runTask(data);
    });

  print([
    "",
    `Running ${tasks.length} task(s) with ${describeModelOptions(model)}...`,
  ]);

  const rows: Array<CodeAgentBenchmarkRow> = [];

  for (const task of tasks) {
    const row: CodeAgentBenchmarkRow = await runTask({
      task,
      model: createProviderModel(model),
      timeLimitInMinutes,
      commandTimeLimitInMinutes,
      keepRepository: hasFlag(argv, "keep-repositories"),
    });

    rows.push(row);
    print([
      `  [${rows.length}/${tasks.length}] ${task.id}: ${
        row.passed
          ? "passed"
          : `failed${row.checkDetail ? ` (${row.checkDetail})` : ""}`
      }, ended by ${row.ending}${row.error ? ` (${row.error})` : ""}`,
    ]);
  }

  fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2), "utf8");

  const summary: CodeAgentBenchmarkSummary = CodeAgentBenchmark.summarize(rows);

  print([
    "",
    "Code agent benchmark - customer-shaped tasks with checks",
    "================================================================================",
    `Model: ${describeModelOptions(model)}   time limit: ${timeLimitInMinutes} minutes a task   command time limit: ${
      commandTimeLimitInMinutes ?? DEFAULT_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES
    } minutes`,
    "",
    ...CodeAgentBenchmark.formatTable(rows),
    "",
    `Passed ${summary.passedCount} of ${summary.taskCount}. Ended: ${Object.entries(
      summary.endings,
    )
      .map((entry: [string, number]): string => {
        return `${entry[1]} ${entry[0]}`;
      })
      .join(
        ", ",
      )}. ${summary.rounds} rounds, ${summary.toolCalls} tool calls, ${summary.totalTokens.toLocaleString(
      "en-US",
    )} tokens, ${CodeAgentBenchmark.describeDuration(summary.durationSeconds)}.`,
    `Every row, with the agent's summary and what a failed check said, is in ${outputPath}.`,
    "",
  ]);

  if (failUnder !== undefined && summary.passedCount < failUnder) {
    print([
      `Fewer tasks passed (${summary.passedCount}) than --fail-under=${failUnder}.`,
    ]);
    return 1;
  }

  return 0;
}
