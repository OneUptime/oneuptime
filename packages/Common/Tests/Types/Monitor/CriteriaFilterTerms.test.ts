import {
  CheckOn,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  CHECK_ON_TERMS,
  EVALUATE_OVER_TIME_TERMS,
  FILTER_TYPE_TERMS,
} from "../../../Types/Monitor/CriteriaFilterTerms";
import { describe, expect, test } from "@jest/globals";

/*
 * The Dashboard words a check, a condition and an evaluation over time by
 * its English value: each must be a key exactly as stored (issue #6542).
 */
describe("CriteriaFilterTerms", () => {
  test.each([
    ["check", Object.values(CheckOn), CHECK_ON_TERMS],
    ["condition", Object.values(FilterType), FILTER_TYPE_TERMS],
    [
      "evaluation over time",
      Object.values(EvaluateOverTimeType),
      EVALUATE_OVER_TIME_TERMS,
    ],
  ])(
    "every %s is its own key",
    (
      _kind: string,
      values: Array<string>,
      terms: Readonly<Record<string, string>>,
    ) => {
      expect(Object.keys(terms).sort()).toEqual([...values].sort());

      for (const value of values) {
        expect(terms[value]).toBe(value);
      }
    },
  );
});
