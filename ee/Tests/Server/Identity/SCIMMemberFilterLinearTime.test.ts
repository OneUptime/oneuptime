import { fastestRun } from "Common/Tests/Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";
import { getMemberIdsFromMemberFilter } from "../../../Server/Identity/Utils/SCIMBelowPlan";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import { namedPattern } from "Common/Tests/Helpers/SourcePatterns";

/*
 * ---------------------------------------------------------------------------
 * A SCIM MEMBERS FILTER IS READ IN TIME IN LINE WITH ITS LENGTH, AND SPLIT AS
 * IT WAS SPLIT BEFORE.
 *
 * A group PATCH from an identity provider can name the members it removes
 * with a filter - members[value eq "<id>" or value eq "<id>"] - which is cut
 * at each " or ". That separator was looked for again from every character
 * of a run of white space "or" does not follow, each try reading on to the
 * end of the run: a long run took time that grew with the square of its
 * length. It is tried only where a run starts now, and cuts the filter at
 * exactly the places it cut it.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const ALICE: string = "aa000000-0000-4000-8000-0000000000a1";
const BOB: string = "aa000000-0000-4000-8000-0000000000b0";

// The separator as it was: the reference the one the filter is cut at must agree with.
const OR_SEPARATOR_BEFORE: RegExp = /\s+or\s+/i;

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

describe("a SCIM members filter is read in time in line with its length", () => {
  test.each([
    [
      "a run of spaces no or follows",
      `members[value eq "${ALICE}"${repeat(" ", LENGTH)}x]`,
    ],
    [
      "a run of tabs and spaces before an or that is a word's start",
      `members[value eq "${ALICE}"${repeat("\t ", LENGTH)}order]`,
    ],
    [
      "runs of white space, each before a condition",
      `members[value eq "${ALICE}"${repeat(` or value eq "${BOB}"`, LENGTH)}]`,
    ],
  ])("%s", (_label: string, path: string) => {
    expect(
      timeOf(() => {
        return getMemberIdsFromMemberFilter(path);
      }),
    ).toBeLessThan(2000);
  });

  test("the filter still names its members", () => {
    expect(
      getMemberIdsFromMemberFilter(
        `members[value eq "${ALICE}"  \t or\t value eq "${BOB}"]`,
      ),
    ).toEqual([ALICE, BOB]);
    expect(
      getMemberIdsFromMemberFilter(
        `members[value eq "${ALICE}"${repeat(" ", LENGTH)}x]`,
      ),
    ).toBeNull();
  });
});

describe("a filter is cut at exactly the places it was cut", () => {
  test("on forty thousand drawn filters", () => {
    const now: RegExp = namedPattern(
      "ee/Server/Identity/Utils/SCIMBelowPlan.ts",
      "OR_SEPARATOR",
    );
    const mismatches: Array<{
      filter: string;
      now: Array<string>;
      before: Array<string>;
    }> = [];
    let cut: number = 0;

    for (const filter of generatedTexts(
      40000,
      4545,
      [" ", "  ", "\t", "\n", " ", "or", "OR", "Or", "o", "r", "x", "a"],
      14,
    )) {
      const before: Array<string> = filter.split(OR_SEPARATOR_BEFORE);
      const actual: Array<string> = filter.split(now);

      if (before.length > 1) {
        cut++;
      }

      if (JSON.stringify(actual) !== JSON.stringify(before)) {
        mismatches.push({ filter, now: actual, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(cut).toBeGreaterThan(5000);
  });
});
