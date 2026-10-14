/*
 * If / Else's comparisons are named in Types/Workflow/Components/
 * ConditionComparison, which the dashboard's string extractor does not read.
 * ConditionModel lists their words (CONDITION_CATALOG_WORDS) so they are
 * extracted and translated; this holds that list to the catalog, so a
 * comparison added there cannot be left out here - and stay English in
 * every language.
 */

import { CONDITION_CATALOG_WORDS } from "../../../../../UI/Components/Workflow/Condition/ConditionModel";
import {
  CONDITION_COMPARE_AS_OPTIONS,
  CONDITION_COMPARISONS,
  CONDITION_COMPARISON_GROUPS,
  CONDITION_VALUE_TYPE_LABELS,
  ConditionCompareAsOption,
  ConditionComparison,
  ConditionComparisonGroup,
} from "../../../../../Types/Workflow/Components/ConditionComparison";
import { describe, expect, test } from "@jest/globals";

// Every word the catalog shows: names, group titles, choices and their rules.
const CATALOG: Array<string> = Array.from(
  new Set<string>([
    ...CONDITION_COMPARISONS.map((comparison: ConditionComparison) => {
      return comparison.label;
    }),
    ...CONDITION_COMPARISON_GROUPS.map((group: ConditionComparisonGroup) => {
      return group.title || "";
    }).filter((title: string) => {
      return title.length > 0;
    }),
    ...CONDITION_COMPARE_AS_OPTIONS.flatMap(
      (option: ConditionCompareAsOption) => {
        return [option.label, option.description];
      },
    ),
    ...Object.values(CONDITION_VALUE_TYPE_LABELS),
  ]),
);

describe("the comparison catalog's words are listed to be translated", () => {
  test("every word the catalog shows is in the list", () => {
    const missing: Array<string> = CATALOG.filter((word: string) => {
      return !CONDITION_CATALOG_WORDS.includes(word);
    });

    expect(missing).toEqual([]);
  });

  test("the list holds nothing the catalog does not show", () => {
    const extra: Array<string> = CONDITION_CATALOG_WORDS.filter(
      (word: string) => {
        return !CATALOG.includes(word);
      },
    );

    expect(extra).toEqual([]);
  });

  test("each word once", () => {
    expect(new Set(CONDITION_CATALOG_WORDS).size).toBe(
      CONDITION_CATALOG_WORDS.length,
    );
  });

  test("the words the If / Else editor shows first are among them", () => {
    expect(CONDITION_CATALOG_WORDS).toEqual(
      expect.arrayContaining([
        "is equal to",
        "is not equal to",
        "is true",
        "is false",
        "True / False",
      ]),
    );
  });
});
