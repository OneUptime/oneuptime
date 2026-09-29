import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { describe, expect, test } from "@jest/globals";

function overTimeFilter(input: {
  checkOn: CheckOn;
  filterType: FilterType;
  value?: number | undefined;
  evaluateOverTimeType: EvaluateOverTimeType;
}): CriteriaFilter {
  return {
    checkOn: input.checkOn,
    filterType: input.filterType,
    value: input.value,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 5,
      evaluateOverTimeType: input.evaluateOverTimeType,
    },
  };
}

/*
 * A true/false filter saved with an aggregate (before the dashboard stopped
 * offering one, or through the API / Terraform) is judged as All Values by
 * the server, so the criteria list must describe it that way too.
 */
describe("Dashboard criteria text for true/false filters over time", () => {
  test.each([
    CheckOn.IsOnline,
    CheckOn.DnsIsOnline,
    CheckOn.SnmpIsOnline,
    CheckOn.ExternalStatusPageIsOnline,
    CheckOn.DatabaseIsOnline,
  ])("%s saved with Average reads as all values", (checkOn: CheckOn) => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        overTimeFilter({
          checkOn: checkOn,
          filterType: FilterType.False,
          evaluateOverTimeType: EvaluateOverTimeType.Average,
        }),
        FilterCondition.All,
      ),
    ).toBe(
      `Check if all values of "${checkOn}" in the past 5 minutes is false and,`,
    );
  });

  test("Any Value is kept as saved", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        overTimeFilter({
          checkOn: CheckOn.DnsIsOnline,
          filterType: FilterType.False,
          evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
        }),
      ),
    ).toBe(
      `Check if any value of "DNS Is Online" in the past 5 minutes is false `,
    );
  });

  test("a numeric filter keeps its aggregate", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        overTimeFilter({
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.GreaterThan,
          value: 500,
          evaluateOverTimeType: EvaluateOverTimeType.MaximumValue,
        }),
      ),
    ).toContain("maximum value ");
  });
});
