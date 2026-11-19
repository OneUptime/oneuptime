import { EvalUsageError, getArgValue } from "../EvalCommandLine";
import { BenchmarkScenario } from "./BenchmarkScenario";

/*
 * The benchmark's own options (npm run ai-benchmark), beside the model
 * options every eval takes (EvalCommandLine):
 *
 *   --scenario=<id>[,<id>]    run only these scenarios
 *   --repeat=<k>              run each scenario k times (#7766): each gets a
 *                             pass rate, and passes when more than half its
 *                             runs did
 *   --fail-under=<n>|<p>%     exit 1 when fewer than n scenarios pass, or
 *                             fewer than p% of them (for CI)
 *   --report-markdown=<path>  add the report, in Markdown, to the end of a
 *                             file: a CI job's summary ($GITHUB_STEP_SUMMARY)
 *
 * A value the benchmark cannot run with is a usage error: the command prints
 * its message alone, before any model is called.
 */

// More runs than this is a typo more often than a plan: each run costs model calls.
export const MAX_BENCHMARK_REPEAT: number = 10;

// Digits only: "1e1", "0x8" and " 8" are typos, not numbers someone means.
const WHOLE_NUMBER: RegExp = /^\d+$/;
const PERCENTAGE: RegExp = /^(\d+(?:\.\d+)?)%$/;

/*
 * The least the benchmark's scenarios must pass: a number of them, or a
 * share of them, which holds as scenarios are added.
 */
export interface BenchmarkFailUnder {
  // As it was given: "8" or "60%".
  given: string;
  // How many of the scenarios run must pass.
  requiredPassedCount: number;
  // Set when it was given as a share of the scenarios.
  percentage?: number | undefined;
}

export default class BenchmarkCommandLine {
  /*
   * The scenarios --scenario names, in the benchmark's order; all of them
   * without it, or with none named (an empty --scenario=, as a CI job
   * passes when it was given no scenarios).
   */
  public static pickScenarios(
    argv: ReadonlyArray<string>,
    scenarios: ReadonlyArray<BenchmarkScenario>,
  ): Array<BenchmarkScenario> {
    const ids: Array<string> = (getArgValue(argv, "scenario") || "")
      .split(",")
      .map((id: string): string => {
        return id.trim();
      })
      .filter(Boolean);

    if (ids.length === 0) {
      return [...scenarios];
    }

    const unknown: Array<string> = ids.filter((id: string): boolean => {
      return !scenarios.some((scenario: BenchmarkScenario): boolean => {
        return scenario.id === id;
      });
    });

    if (unknown.length > 0) {
      throw new EvalUsageError(
        `Unknown scenario(s): ${unknown.join(", ")}. Run with --list to see them.`,
      );
    }

    return scenarios.filter((scenario: BenchmarkScenario): boolean => {
      return ids.includes(scenario.id);
    });
  }

  // How many times each scenario runs: 1 without --repeat.
  public static readRepeat(argv: ReadonlyArray<string>): number {
    const value: string | undefined = getArgValue(argv, "repeat");

    if (value === undefined) {
      return 1;
    }

    const parsed: number = Number(value);

    if (
      !WHOLE_NUMBER.test(value) ||
      parsed < 1 ||
      parsed > MAX_BENCHMARK_REPEAT
    ) {
      throw new EvalUsageError(
        `--repeat must be a whole number from 1 to ${MAX_BENCHMARK_REPEAT}, got "${value}".`,
      );
    }

    return parsed;
  }

  /*
   * --fail-under, for the scenarios being run: a whole number of them from
   * 0 to all of them, or a percentage from 0% to 100% (rounded up to whole
   * scenarios: 60% of 13 is 8). Undefined without it.
   */
  public static readFailUnder(
    argv: ReadonlyArray<string>,
    scenarioCount: number,
  ): BenchmarkFailUnder | undefined {
    const value: string | undefined = getArgValue(argv, "fail-under");

    if (value === undefined) {
      return undefined;
    }

    const given: string = value.trim();
    const usage: EvalUsageError = new EvalUsageError(
      `--fail-under must be a whole number of scenarios from 0 to ${scenarioCount}, or a percentage of them from 0% to 100%, got "${value}".`,
    );
    const percentageMatch: RegExpExecArray | null = PERCENTAGE.exec(given);

    if (percentageMatch) {
      const percentage: number = Number(percentageMatch[1]);

      if (percentage > 100) {
        throw usage;
      }

      return {
        given,
        percentage,
        requiredPassedCount: this.getRequiredPassedCount(
          percentage,
          scenarioCount,
        ),
      };
    }

    const parsed: number = Number(given);

    if (!WHOLE_NUMBER.test(given) || parsed > scenarioCount) {
      throw usage;
    }

    return { given, requiredPassedCount: parsed };
  }

  // The scenarios a percentage asks to pass, rounded up: 60% of 13 is 8.
  public static getRequiredPassedCount(
    percentage: number,
    scenarioCount: number,
  ): number {
    // Rounded first, so 70% of 10 is 7 and not 7.000000000000001, made 8.
    const exact: number = Number(
      ((percentage * scenarioCount) / 100).toFixed(9),
    );

    return Math.min(scenarioCount, Math.ceil(exact));
  }

  // Whether the run passed fewer scenarios than --fail-under asks.
  public static isUnderThreshold(
    passedCount: number,
    failUnder: BenchmarkFailUnder | undefined,
  ): boolean {
    return (
      failUnder !== undefined && passedCount < failUnder.requiredPassedCount
    );
  }

  // Where --report-markdown asks for the Markdown report; undefined without it.
  public static readReportMarkdownPath(
    argv: ReadonlyArray<string>,
  ): string | undefined {
    const value: string | undefined = getArgValue(argv, "report-markdown");

    if (value === undefined) {
      return undefined;
    }

    if (value.trim() === "") {
      throw new EvalUsageError(
        '--report-markdown needs a file to add the report to, such as --report-markdown="$GITHUB_STEP_SUMMARY".',
      );
    }

    return value.trim();
  }
}
