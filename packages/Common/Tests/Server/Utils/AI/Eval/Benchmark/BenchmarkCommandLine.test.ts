import BenchmarkCommandLine, {
  BenchmarkFailUnder,
  MAX_BENCHMARK_REPEAT,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkCommandLine";
import {
  BenchmarkFaultKind,
  BenchmarkScenario,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScenario";
import BENCHMARK_SCENARIOS from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScenarios";
import { EvalUsageError } from "../../../../../../Server/Utils/AI/Eval/EvalCommandLine";
import { describe, expect, test } from "@jest/globals";

/*
 * THE BENCHMARK'S OWN OPTIONS (issues #6800, #7764, #7766): which scenarios
 * run, how many times each, the least that must pass for a CI job to stay
 * green, and where a CI job's summary goes. Every value the benchmark
 * cannot run with is a usage error, raised before any model is called.
 */

function scenario(id: string): BenchmarkScenario {
  return {
    id,
    title: `Scenario ${id}`,
    faultKind: BenchmarkFaultKind.BadDeploy,
    plantedFault: "A planted fault.",
    declaredAt: "2026-03-10T14:07:00.000Z",
    minutesSinceDeclared: 4,
    contextText: "# Incident\nTitle: A scenario",
    responses: [],
    expectation: {
      rootCause: "A planted fault.",
      mustMention: [["planted"]],
      distractors: [],
    },
  };
}

const SCENARIOS: Array<BenchmarkScenario> = [
  scenario("alpha"),
  scenario("beta"),
  scenario("gamma"),
];

function ids(scenarios: Array<BenchmarkScenario>): Array<string> {
  return scenarios.map((one: BenchmarkScenario): string => {
    return one.id;
  });
}

function usageErrorOf(run: () => unknown): EvalUsageError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EvalUsageError);
    return error as EvalUsageError;
  }

  throw new Error("Expected a usage error.");
}

describe("--scenario picks the scenarios that run", () => {
  test("without it, or with none named, every scenario runs, in the benchmark's order", () => {
    for (const argv of [
      [],
      ["--scenario="],
      ["--scenario=,"],
      ["--scenario= , "],
    ]) {
      expect(ids(BenchmarkCommandLine.pickScenarios(argv, SCENARIOS))).toEqual([
        "alpha",
        "beta",
        "gamma",
      ]);
    }
  });

  test("the named ones run, in the benchmark's order, whatever order they were named in", () => {
    expect(
      ids(
        BenchmarkCommandLine.pickScenarios(
          ["--scenario=gamma, alpha"],
          SCENARIOS,
        ),
      ),
    ).toEqual(["alpha", "gamma"]);
  });

  test("an unknown id is a usage error that names it", () => {
    expect(
      usageErrorOf(() => {
        return BenchmarkCommandLine.pickScenarios(
          ["--scenario=alpha,delta,epsilon"],
          SCENARIOS,
        );
      }).message,
    ).toBe("Unknown scenario(s): delta, epsilon. Run with --list to see them.");
  });

  test("every scenario of the benchmark can be named", () => {
    for (const one of BENCHMARK_SCENARIOS) {
      expect(
        ids(
          BenchmarkCommandLine.pickScenarios(
            [`--scenario=${one.id}`],
            BENCHMARK_SCENARIOS,
          ),
        ),
      ).toEqual([one.id]);
    }
  });
});

describe("--repeat runs each scenario several times", () => {
  test("once without it", () => {
    expect(BenchmarkCommandLine.readRepeat([])).toBe(1);
  });

  test.each([
    ["1", 1],
    ["3", 3],
    [String(MAX_BENCHMARK_REPEAT), MAX_BENCHMARK_REPEAT],
  ])("--repeat=%s runs it %i times", (value: string, times: number) => {
    expect(BenchmarkCommandLine.readRepeat([`--repeat=${value}`])).toBe(times);
  });

  test.each(["0", "-1", "1.5", "", " ", "three", "11", "1e1"])(
    '--repeat="%s" is a usage error',
    (value: string) => {
      expect(
        usageErrorOf(() => {
          return BenchmarkCommandLine.readRepeat([`--repeat=${value}`]);
        }).message,
      ).toBe(
        `--repeat must be a whole number from 1 to ${MAX_BENCHMARK_REPEAT}, got "${value}".`,
      );
    },
  );

  test("each run costs model calls, so the most is 10", () => {
    expect(MAX_BENCHMARK_REPEAT).toBe(10);
  });
});

describe("--fail-under sets the least that must pass", () => {
  test("none without it", () => {
    expect(BenchmarkCommandLine.readFailUnder([], 13)).toBeUndefined();
  });

  test("a whole number of scenarios, from 0 to all of them", () => {
    expect(BenchmarkCommandLine.readFailUnder(["--fail-under=8"], 13)).toEqual({
      given: "8",
      requiredPassedCount: 8,
    });
    expect(BenchmarkCommandLine.readFailUnder(["--fail-under=0"], 13)).toEqual({
      given: "0",
      requiredPassedCount: 0,
    });
    expect(BenchmarkCommandLine.readFailUnder(["--fail-under=13"], 13)).toEqual(
      { given: "13", requiredPassedCount: 13 },
    );
  });

  test.each([
    ["60%", 13, 8],
    ["50%", 10, 5],
    ["70%", 10, 7],
    ["100%", 13, 13],
    ["0%", 13, 0],
    ["33.3%", 3, 1],
    ["1%", 13, 1],
  ])(
    "a percentage of the scenarios, rounded up to whole ones: %s of %i is %i",
    (given: string, scenarioCount: number, required: number) => {
      expect(
        BenchmarkCommandLine.readFailUnder(
          [`--fail-under=${given}`],
          scenarioCount,
        ),
      ).toEqual({
        given,
        percentage: Number(given.replace("%", "")),
        requiredPassedCount: required,
      });
    },
  );

  test.each(["14", "-1", "2.5", "", "eight", "101%", "-5%", "%", "x%", "1e1"])(
    '--fail-under="%s" is a usage error, for 13 scenarios',
    (value: string) => {
      expect(
        usageErrorOf(() => {
          return BenchmarkCommandLine.readFailUnder(
            [`--fail-under=${value}`],
            13,
          );
        }).message,
      ).toBe(
        `--fail-under must be a whole number of scenarios from 0 to 13, or a percentage of them from 0% to 100%, got "${value}".`,
      );
    },
  );

  test("a run that passed fewer scenarios than it asks is under it; as many or more is not", () => {
    const eight: BenchmarkFailUnder = { given: "8", requiredPassedCount: 8 };

    expect(BenchmarkCommandLine.isUnderThreshold(7, eight)).toBe(true);
    expect(BenchmarkCommandLine.isUnderThreshold(8, eight)).toBe(false);
    expect(BenchmarkCommandLine.isUnderThreshold(13, eight)).toBe(false);
    expect(BenchmarkCommandLine.isUnderThreshold(0, undefined)).toBe(false);
  });
});

describe("--report-markdown says where a CI job's summary goes", () => {
  test("nowhere without it", () => {
    expect(BenchmarkCommandLine.readReportMarkdownPath([])).toBeUndefined();
  });

  test("the file it names", () => {
    expect(
      BenchmarkCommandLine.readReportMarkdownPath([
        "--report-markdown=/home/runner/work/_temp/_runner_file_commands/step_summary_1",
      ]),
    ).toBe("/home/runner/work/_temp/_runner_file_commands/step_summary_1");
  });

  test("an empty one is a usage error: a CI job whose summary file is missing says so", () => {
    expect(
      usageErrorOf(() => {
        return BenchmarkCommandLine.readReportMarkdownPath([
          "--report-markdown=",
        ]);
      }).message,
    ).toBe(
      '--report-markdown needs a file to add the report to, such as --report-markdown="$GITHUB_STEP_SUMMARY".',
    );
  });
});
