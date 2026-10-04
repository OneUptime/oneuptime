import { describe, expect, test } from "@jest/globals";
import {
  FILTERS_TO_COMBINE,
  isFilterConditionNeeded,
} from "../../../Types/Filter/FilterConditionUtil";

/*
 * All or Any only means something once there are two filters to combine:
 * with none a rule matches everything, with one it matches what that filter
 * matches whichever is picked. The conditions builder (RuleCriteriaBuilder)
 * and a metric pipeline rule's Filter Condition ask for it from the second
 * filter on, through this one rule.
 */
describe("isFilterConditionNeeded", () => {
  test("starts at two filters", () => {
    expect(FILTERS_TO_COMBINE).toBe(2);
  });

  interface Case {
    name: string;
    filters: unknown;
    expected: boolean;
  }

  test.each<Case>([
    { name: "no filters", filters: [], expected: false },
    { name: "one filter", filters: [{ value: "a" }], expected: false },
    {
      name: "two filters",
      filters: [{ value: "a" }, { value: "b" }],
      expected: true,
    },
    { name: "four filters", filters: [1, 2, 3, 4], expected: true },
  ])("$name: asks for a condition - $expected", (row: Case) => {
    expect(isFilterConditionNeeded(row.filters)).toBe(row.expected);
  });

  /*
   * A form holds no list until its filters editor has drawn: nothing to
   * combine yet.
   */
  test.each<Case>([
    { name: "undefined", filters: undefined, expected: false },
    { name: "null", filters: null, expected: false },
    { name: "a string", filters: "two", expected: false },
    { name: "a number", filters: 2, expected: false },
    {
      name: "an object with a length",
      filters: { length: 3 },
      expected: false,
    },
  ])("reads $name as no filters", (row: Case) => {
    expect(isFilterConditionNeeded(row.filters)).toBe(row.expected);
  });
});
