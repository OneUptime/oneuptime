import { describe, expect, test } from "@jest/globals";
import MetricFormulaEvaluator from "../../../Utils/Metrics/MetricFormulaEvaluator";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * Whether a formula's value grows with how long a stretch each point covers
 * (issue #5759): a count over an hour is about sixty of its minutes, but a
 * share of two counts is the same share. A monitor's threshold line on a
 * formula holds at any chart range only when it does not grow.
 */

const COUNTS: ReadonlyArray<string> = ["failed", "total", "a", "b"];

const scales: (formula: string) => boolean | null = (
  formula: string,
): boolean | null => {
  return MetricFormulaEvaluator.scalesWithBucketWidth({
    formula,
    variableScales: (variable: string): boolean | null => {
      if (COUNTS.includes(variable)) {
        return true;
      }

      if (variable === "cpu" || variable === "mem") {
        return false;
      }

      return null;
    },
  });
};

describe("MetricFormulaEvaluator.scalesWithBucketWidth", () => {
  test.each([
    ["failed / total * 100", false],
    ["(failed / total) * 100", false],
    ["100 * failed / total", false],
    ["100 - failed / total * 100", false],
    ["(a - b) / b", false],
    ["$failed / $TOTAL", false],
    ["cpu", false],
    ["cpu * 100 + mem", false],
    ["-cpu", false],
    ["2 ^ 3", false],
    ["failed", true],
    ["failed / 60", true],
    ["a - b", true],
    ["a * b / total", true],
    ["a + 1", true],
    ["a + cpu", true],
    ["a % 7", true],
    ["a ^ 2", true],
    ["a ^ cpu", true],
    // A gauge raised to a count still changes with the count.
    ["cpu ^ a", true],
    ["+a / -b", false],
  ])("%s grows with the bucket: %s", (formula: string, expected: boolean) => {
    expect(scales(formula)).toBe(expected);
  });

  test("a formula that cannot be read, or names a variable nobody can tell about, says nothing", () => {
    expect(scales("")).toBeNull();
    expect(scales("   ")).toBeNull();
    expect(scales("a +")).toBeNull();
    expect(scales("(a / b")).toBeNull();
    expect(scales("a b")).toBeNull();
    expect(scales("a / unknown")).toBeNull();
    expect(scales("a & b")).toBeNull();
  });

  test("variables are handed over lowercase", () => {
    const seen: Array<string> = [];

    MetricFormulaEvaluator.scalesWithBucketWidth({
      formula: "$Failed / Total",
      variableScales: (variable: string): boolean => {
        seen.push(variable);
        return true;
      },
    });

    expect(seen).toEqual(["failed", "total"]);
  });

  test("a sum of shares never grows, a share of sums never does either (seeded)", () => {
    const random: SeededRandom = seededRandom(60);

    for (let round: number = 0; round < 500; round++) {
      const termCount: number = 1 + random(4);
      const terms: Array<string> = [];

      for (let index: number = 0; index < termCount; index++) {
        const top: string = COUNTS[random(COUNTS.length)]!;
        const bottom: string = COUNTS[random(COUNTS.length)]!;
        const factor: number = 1 + random(100);
        terms.push(
          random(2) === 0
            ? `${top} / ${bottom} * ${factor}`
            : `(${factor} * ${top}) / ${bottom}`,
        );
      }

      const formula: string = terms.join(random(2) === 0 ? " + " : " - ");

      expect(scales(formula)).toBe(false);
      // The same sum with one count left undivided grows.
      expect(scales(`${formula} + ${COUNTS[random(COUNTS.length)]!}`)).toBe(
        true,
      );
    }
  });
});
