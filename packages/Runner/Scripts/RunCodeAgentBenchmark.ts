import { runCodeAgentBenchmark } from "../Benchmark/CodeAgentBenchmarkCommandLine";
import { EvalUsageError } from "Common/Server/Utils/AI/Eval/EvalCommandLine";

/*
 * Code agent benchmark - `npm run benchmark` in packages/Runner (issue
 * #6531).
 *
 * Runs the real in-house code agent (InHouseCodeAgent) - its prompt, its
 * tools, its loop and its limits - with the model you name, on tasks shaped
 * like the work customers hand Code (Benchmark/CodeAgentBenchmarkTasks): a
 * bug behind an exception in a 2,000-line file, a failing test, a change
 * across several files, a slow test suite. Each task's check tells a fixed
 * repository from an unfixed one. One row a task: passed or not, how the
 * run ended, its rounds, its tool calls by tool, its tokens and its time.
 *
 * It spends real AI credits, so it runs only when asked: the model's key
 * comes from AI_EVAL_LLM_API_KEY, and without it the benchmark skips and
 * exits 0 (exits 1 with --require-key). The agent's commands run on this
 * machine, in temporary copies of the tasks' repositories: run it in a
 * container or CI, as a Runner of your own runs them. Its arguments are
 * Benchmark/CodeAgentBenchmarkCommandLine's.
 *
 *   AI_EVAL_LLM_API_KEY=... npm run benchmark -- --llm-type=Anthropic --model=claude-opus-5-5
 */

runCodeAgentBenchmark({
  argv: process.argv.slice(2),
  env: process.env,
  print: (lines: Array<string>): void => {
    // A CLI report - stdout is the interface, matching the script idiom.
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
  },
})
  .then((exitCode: number) => {
    process.exit(exitCode);
  })
  .catch((error: unknown) => {
    if (error instanceof EvalUsageError) {
      // A usage hint: its message is the whole of it.
      // eslint-disable-next-line no-console
      console.error(error.message);
    } else {
      // eslint-disable-next-line no-console
      console.error("Code agent benchmark failed:");
      // eslint-disable-next-line no-console
      console.error(error);
    }
    process.exit(1);
  });
