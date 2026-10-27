import KubernetesCpuUtils from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCpuUtils";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { patternWith } from "../../Helpers/SourcePatterns";
import { fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A KUBERNETES CPU QUANTITY IS READ IN TIME IN LINE WITH ITS LENGTH, AND READ
 * AS IT WAS READ BEFORE.
 *
 * The cluster pages read the CPU requests and limits a cluster's agent
 * reported - "500m", "2", "250000u" - into cores. The number was read as
 * "[0-9]*\.?[0-9]+", which can split a run of digits between its two runs in
 * as many ways as the run is long: a long run of digits that did not match
 * was tried every way, in time that grew with the square of its length (the
 * memory limits the inventory reads at ingest were read the same way). Now a
 * number reads one way only - digits, digits "." digits, or "." digits - and
 * matches exactly what it matched.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const CPU_UTILS_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCpuUtils.ts";

// The pattern as it was: the reference the one the page runs must agree with.
const QUANTITY_BEFORE: RegExp = /^([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)$/;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

/*
 * How long the work takes: the fastest of up to three attempts, counted as
 * it would have run on a usual runner when every attempt overran on a slow
 * one (Tests/Helpers/FastestRun).
 */
const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  return fastestRun({ run: run, limitInMs: 2000 }).inMs;
};

describe("a CPU quantity is read in time in line with its length", () => {
  test.each([
    ["digits, then a character no number holds", repeat("1", LENGTH) + "!"],
    ["digits, a point, digits, then a point", repeat("1", LENGTH) + ".5."],
    ["a point, then digits and a space", "." + repeat("9", LENGTH) + " 1"],
  ])("%s", (_label: string, quantity: string) => {
    let cores: number = -1;

    expect(
      timeOf(() => {
        cores = KubernetesCpuUtils.parseCpuToCores(quantity);
      }),
    ).toBeLessThan(2000);
    expect(cores).toBe(0);
  });
});

describe("a CPU quantity reads as it did", () => {
  test("cores, milli-, micro- and nanocores", () => {
    expect(KubernetesCpuUtils.parseCpuToCores("4")).toBe(4);
    expect(KubernetesCpuUtils.parseCpuToCores("500m")).toBe(0.5);
    expect(KubernetesCpuUtils.parseCpuToCores("250000u")).toBe(0.25);
    expect(KubernetesCpuUtils.parseCpuToCores("1500000000n")).toBe(1.5);
    expect(KubernetesCpuUtils.parseCpuToCores(".5")).toBe(0.5);
    expect(KubernetesCpuUtils.parseCpuToCores("1.5 k")).toBe(1500);
    // Not a quantity the pattern reads: read as a number, as before.
    expect(KubernetesCpuUtils.parseCpuToCores("1e3")).toBe(1000);
    expect(KubernetesCpuUtils.parseCpuToCores("1.")).toBe(1);
    expect(KubernetesCpuUtils.parseCpuToCores("abc")).toBe(0);
  });

  test("the page's pattern matches exactly what the old one did, on forty thousand drawn quantities", () => {
    const now: RegExp = patternWith(CPU_UTILS_FILE, "\\s*([a-zA-Z]*)$");
    const mismatches: Array<{
      quantity: string;
      now: string;
      before: string;
    }> = [];
    let matched: number = 0;

    for (const quantity of generatedTexts(
      40000,
      8080,
      ["0", "1", "9", "25", ".", " ", "\t", "m", "n", "Mi", "e", "-", "!"],
      8,
    )) {
      const expected: string = JSON.stringify(QUANTITY_BEFORE.exec(quantity));
      const actual: string = JSON.stringify(now.exec(quantity));

      if (expected !== "null") {
        matched++;
      }

      if (actual !== expected) {
        mismatches.push({ quantity, now: actual, before: expected });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(matched).toBeGreaterThan(3000);
  });
});
