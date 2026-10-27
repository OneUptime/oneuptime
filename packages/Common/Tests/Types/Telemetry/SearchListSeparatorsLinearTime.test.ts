import Includes from "../../../Types/BaseDatabase/Includes";
import {
  SearchValueOperator,
  SearchValuePredicate,
  parseSearchValue,
  splitOnListSeparators,
} from "../../../Types/Telemetry/TelemetrySearchQuery";
import { buildSearchTokenForOperatorValue } from "../../../Utils/Telemetry/LockedFilterSearch";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { namedPattern } from "../../Helpers/SourcePatterns";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * A SEARCH'S LIST IS SPLIT IN TIME IN LINE WITH ITS LENGTH, AND AT THE
 * PLACES IT WAS SPLIT BEFORE.
 *
 * A telemetry search spells a list "(a OR b)" or "[a, b]", and its entries
 * are split at a "," or at white space, "OR" and white space. A search can
 * come from a shared link or a saved view, and a filter's entries are values
 * somebody's telemetry carried. The separator pattern was tried again from
 * every place in a run of white space that "OR" does not follow, each try
 * reading the rest of the run: the viewer's page stalled on a long one. The
 * split now reads each run of white space once, and the check that an entry
 * cannot be spelled inside a list looks for one white space character on
 * each side of the "OR" - all it takes.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const SPLIT_BEFORE: RegExp = /\s+OR\s+|,/i;
const UNSAFE_BEFORE: RegExp = /,|\s+OR\s+/i;

describe("a list is read in time in line with its length", () => {
  test.each([
    ["a run of tabs", "(" + repeat("\t", LENGTH) + "a)"],
    ["runs of white space between words", "(" + repeat("a \t ", LENGTH) + ")"],
    [
      "white space before OR with none after",
      "(" + repeat(" ", LENGTH) + "ORx)",
    ],
  ])("a typed list: %s", (_label: string, value: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        parseSearchValue(value);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });

  test.each([
    ["a run of tabs", repeat("\t", LENGTH)],
    ["white space before OR with none after", repeat(" ", LENGTH) + "ORx"],
  ])("a filter's entry: %s", (_label: string, entry: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        buildSearchTokenForOperatorValue("k8s.ns", new Includes([entry, "b"]));
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("a list is split where it was split before", () => {
  test("at commas and at OR between white space, in any case", () => {
    expect(splitOnListSeparators("a OR b, c or\td")).toEqual([
      "a",
      "b",
      " c",
      "d",
    ]);
    expect(splitOnListSeparators("aOR b,OR")).toEqual(["aOR b", "OR"]);
    expect(splitOnListSeparators("")).toEqual([""]);
  });

  test("a parsed list keeps its entries", () => {
    const predicate: SearchValuePredicate = parseSearchValue("(api OR web)");

    expect(predicate.operator).toBe(SearchValueOperator.In);
    expect(predicate.values).toEqual(["api", "web"]);
  });

  test("on forty thousand drawn lists", () => {
    const mismatches: Array<{ text: string; now: string; before: string }> = [];
    let split: number = 0;

    for (const text of generatedTexts(
      40000,
      2442,
      [
        "OR",
        "or",
        "Or",
        "oR",
        "O",
        "R",
        " ",
        " ",
        "\t",
        "\n",
        "\u00a0",
        ",",
        "a",
        '"',
        "ORx",
        "xOR",
      ],
      14,
    )) {
      const before: string = JSON.stringify(text.split(SPLIT_BEFORE));
      const now: string = JSON.stringify(splitOnListSeparators(text));

      if (before !== JSON.stringify([text])) {
        split++;
      }

      if (now !== before) {
        mismatches.push({ text, now, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(split).toBeGreaterThan(10000);
  });
});

describe("an entry a list cannot spell is found as it was found before", () => {
  test("on forty thousand drawn entries", () => {
    const now: RegExp = namedPattern(
      "packages/Common/Utils/Telemetry/LockedFilterSearch.ts",
      "LIST_UNSAFE_ENTRY",
    );
    const mismatches: Array<{ text: string; now: boolean; before: boolean }> =
      [];
    let unsafe: number = 0;

    for (const text of generatedTexts(
      40000,
      3553,
      ["OR", "or", " ", "\t", "\n", ",", "a", "ORx", "\u2028"],
      12,
    )) {
      const before: boolean = UNSAFE_BEFORE.test(text);
      const actual: boolean = now.test(text);

      if (before) {
        unsafe++;
      }

      if (actual !== before) {
        mismatches.push({ text, now: actual, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(unsafe).toBeGreaterThan(10000);
  });

  test("such an entry still gets no token", () => {
    expect(
      buildSearchTokenForOperatorValue("k8s.ns", new Includes(["a OR b", "c"])),
    ).toBeNull();
    expect(
      buildSearchTokenForOperatorValue(
        "k8s.ns",
        new Includes(["a\tor\tb", "c"]),
      ),
    ).toBeNull();
  });
});
