import {
  getMonitorTypeCriteriaValidationError,
  isMonitorTypeCriteriaValue,
} from "../../../Utils/Rules/MonitorTypeRuleCriteria";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  RuleCriteriaFilter,
  RuleCriteriaOperator,
  RuleCriteriaValue,
} from "../../../Types/Rules/RuleCriteria";
import { describe, expect, test } from "@jest/globals";

/*
 * The gate that decides whether a rule's `monitorType` criterion may be saved.
 * DatabaseService runs it on every write and the SLO monitor-rule engine runs
 * it again when it matches monitors, so a criterion this lets through has to
 * be one the engine can actually evaluate: a monitor type is an enum choice,
 * which means an exact match either way and nothing else. A text operator
 * slipping past here is a rule that silently matches nothing.
 */

function buildFilter(
  operator: RuleCriteriaOperator,
  value: RuleCriteriaValue,
): RuleCriteriaFilter {
  return { field: "monitorType", operator: operator, value: value };
}

const OPERATOR_ERROR: string =
  "Monitor type criteria only support Equals and Does not equal operators.";
const VALUE_ERROR: string =
  "Monitor type criteria require a valid monitor type.";

describe("isMonitorTypeCriteriaValue", () => {
  test("accepts every monitor type the product defines", () => {
    const allTypes: Array<string> = Object.values(MonitorType);
    expect(allTypes.length).toBeGreaterThan(0);
    for (const monitorType of allTypes) {
      expect(isMonitorTypeCriteriaValue(monitorType)).toBe(true);
    }
  });

  test("rejects a string that is not a monitor type", () => {
    expect(isMonitorTypeCriteriaValue("Website")).toBe(
      Object.values(MonitorType).includes("Website" as MonitorType),
    );
    expect(isMonitorTypeCriteriaValue("NotAMonitorType")).toBe(false);
    expect(isMonitorTypeCriteriaValue("")).toBe(false);
  });

  test("is case- and whitespace-sensitive, as an enum comparison must be", () => {
    const [first] = Object.values(MonitorType) as Array<string>;
    expect(isMonitorTypeCriteriaValue(first!)).toBe(true);
    expect(isMonitorTypeCriteriaValue(first!.toLowerCase())).toBe(
      first === first!.toLowerCase(),
    );
    expect(isMonitorTypeCriteriaValue(` ${first!}`)).toBe(false);
    expect(isMonitorTypeCriteriaValue(`${first!} `)).toBe(false);
  });

  test("rejects every non-string value a criterion can carry", () => {
    const nonStrings: Array<unknown> = [
      undefined,
      null,
      0,
      1,
      true,
      false,
      [],
      [Object.values(MonitorType)[0]],
      {},
      { value: Object.values(MonitorType)[0] },
    ];
    for (const value of nonStrings) {
      expect(isMonitorTypeCriteriaValue(value)).toBe(false);
    }
  });

  test("does not accept an inherited Object property as a monitor type", () => {
    // The lookup is a Set, not a plain object, so "toString" is not a member.
    expect(isMonitorTypeCriteriaValue("toString")).toBe(false);
    expect(isMonitorTypeCriteriaValue("constructor")).toBe(false);
    expect(isMonitorTypeCriteriaValue("__proto__")).toBe(false);
  });
});

describe("getMonitorTypeCriteriaValidationError", () => {
  const validType: MonitorType = Object.values(MonitorType)[0] as MonitorType;

  test("passes Equals and NotEquals against a real monitor type", () => {
    for (const operator of [
      RuleCriteriaOperator.Equals,
      RuleCriteriaOperator.NotEquals,
    ]) {
      expect(
        getMonitorTypeCriteriaValidationError(buildFilter(operator, validType)),
      ).toBeNull();
    }
  });

  test("passes every monitor type under Equals", () => {
    for (const monitorType of Object.values(MonitorType)) {
      expect(
        getMonitorTypeCriteriaValidationError(
          buildFilter(RuleCriteriaOperator.Equals, monitorType),
        ),
      ).toBeNull();
    }
  });

  test("rejects every operator other than Equals and NotEquals", () => {
    const rejected: Array<RuleCriteriaOperator> = Object.values(
      RuleCriteriaOperator,
    ).filter((operator: RuleCriteriaOperator) => {
      return (
        operator !== RuleCriteriaOperator.Equals &&
        operator !== RuleCriteriaOperator.NotEquals
      );
    });
    expect(rejected.length).toBeGreaterThan(0);

    for (const operator of rejected) {
      expect(
        getMonitorTypeCriteriaValidationError(buildFilter(operator, validType)),
      ).toBe(OPERATOR_ERROR);
    }
  });

  test("reports the operator first when both the operator and the value are wrong", () => {
    expect(
      getMonitorTypeCriteriaValidationError(
        buildFilter(RuleCriteriaOperator.Contains, "NotAMonitorType"),
      ),
    ).toBe(OPERATOR_ERROR);
  });

  test("rejects a value that is not a monitor type under a supported operator", () => {
    for (const operator of [
      RuleCriteriaOperator.Equals,
      RuleCriteriaOperator.NotEquals,
    ]) {
      expect(
        getMonitorTypeCriteriaValidationError(
          buildFilter(operator, "NotAMonitorType"),
        ),
      ).toBe(VALUE_ERROR);
      expect(
        getMonitorTypeCriteriaValidationError(buildFilter(operator, "")),
      ).toBe(VALUE_ERROR);
      /*
       * An array is what the HasAnyOf-style operators carry; it is not a
       * monitor type even when every member of it is one.
       */
      expect(
        getMonitorTypeCriteriaValidationError(
          buildFilter(operator, [validType]),
        ),
      ).toBe(VALUE_ERROR);
      expect(
        getMonitorTypeCriteriaValidationError(buildFilter(operator, true)),
      ).toBe(VALUE_ERROR);
      expect(
        getMonitorTypeCriteriaValidationError(buildFilter(operator, 0)),
      ).toBe(VALUE_ERROR);
    }
  });

  test("ignores the filter's field: the caller decides which field this applies to", () => {
    expect(
      getMonitorTypeCriteriaValidationError({
        field: "somethingElse",
        operator: RuleCriteriaOperator.Equals,
        value: validType,
      }),
    ).toBeNull();
  });

  test("the two errors are distinct, so a form can say which one it is", () => {
    expect(OPERATOR_ERROR).not.toBe(VALUE_ERROR);
  });
});
