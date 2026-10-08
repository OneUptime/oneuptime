import CriteriaNameUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaName";
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import { describe, expect, test } from "@jest/globals";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

/*
 * A Result Value filter on a custom code or synthetic monitor can compare one
 * field of the data the script returned (customCodeMonitorOptions.
 * resultValuePath). The criteria's generated name and its line in the
 * criteria list must say which field, or two criteria on different fields
 * of one result read identically - in the form and in the "Incident
 * triggered from criteria ..." text the name ends up in.
 */

function resultValueFilter(data: Partial<CriteriaFilter>): CriteriaFilter {
  return {
    checkOn: CheckOn.ResultValue,
    filterType: FilterType.GreaterThan,
    value: 90,
    ...data,
  };
}

describe("Result Value field path in criteria names", () => {
  test("the name says which field is compared", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        resultValueFilter({
          customCodeMonitorOptions: { resultValuePath: "cpu_busy_percent" },
        }),
      ),
    ).toBe("Result Value at cpu_busy_percent is above 90");
  });

  test("criteria on two fields of one result get different names", () => {
    const cpu: string = CriteriaNameUtil.getNameFromFilters({
      filters: [
        resultValueFilter({
          customCodeMonitorOptions: { resultValuePath: "cpu_busy_percent" },
        }),
      ],
    });

    const memory: string = CriteriaNameUtil.getNameFromFilters({
      filters: [
        resultValueFilter({
          customCodeMonitorOptions: {
            resultValuePath: "memory_used_percent",
          },
        }),
      ],
    });

    expect(cpu).not.toBe(memory);
  });

  test("a nested path and a true/false condition", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        resultValueFilter({
          filterType: FilterType.False,
          value: undefined,
          customCodeMonitorOptions: { resultValuePath: "data.items[0].ok" },
        }),
      ),
    ).toBe("Result Value at data.items[0].ok is false");
  });

  test("no path, or a blank one, keeps the name it always had", () => {
    expect(CriteriaNameUtil.describeFilter(resultValueFilter({}))).toBe(
      "Result Value is above 90",
    );

    expect(
      CriteriaNameUtil.describeFilter(
        resultValueFilter({
          customCodeMonitorOptions: { resultValuePath: "   " },
        }),
      ),
    ).toBe("Result Value is above 90");
  });

  test("a path left on another check is not named", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        resultValueFilter({
          checkOn: CheckOn.ExecutionTime,
          value: 5000,
          customCodeMonitorOptions: { resultValuePath: "status" },
        }),
      ),
    ).toBe("Execution Time (in ms) is above 5000");
  });
});

describe("Result Value field path in the criteria list", () => {
  test("the line says which field is compared", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        resultValueFilter({
          customCodeMonitorOptions: { resultValuePath: "cpu_busy_percent" },
        }),
        FilterCondition.Any,
      ),
    ).toBe(
      'Check if "Result Value" at cpu_busy_percent is greater than 90 or,',
    );
  });

  test("no path keeps the line it always had", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(resultValueFilter({})),
    ).toBe('Check if "Result Value" is greater than 90 ');
  });
});

describe("Result Value filter conditions", () => {
  test("True and False are offered, for a field that holds a boolean", () => {
    const filterTypes: Array<string> =
      CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(CheckOn.ResultValue).map(
        (option: DropdownOption) => {
          return option.value.toString();
        },
      );

    expect(filterTypes).toContain(FilterType.True);
    expect(filterTypes).toContain(FilterType.False);
    expect(filterTypes).toContain(FilterType.GreaterThan);
    expect(filterTypes).toContain(FilterType.EqualTo);
  });
});
