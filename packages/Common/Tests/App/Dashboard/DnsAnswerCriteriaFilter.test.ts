import CriteriaFilterUiUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
  PreviousCheckChangeType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * "ALERT ME WHEN THE DNS ANSWER CHANGES", IN THE CRITERIA FORM (#10905).
 *
 * DNS Record Value, Evaluate this criteria over a period of time, Previous
 * Check, Not Equal To. The form offers the window, Previous Check alone in it,
 * and the two conditions an answer compared with the previous one takes; it
 * starts there when the box is ticked, and the sentence reads it back.
 */

function values(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption): string => {
    return String(option.value);
  });
}

const RECORD_VALUE: CriteriaFilter = {
  checkOn: CheckOn.DnsRecordValue,
  filterType: FilterType.Contains,
  value: "93.184.216",
};

function comparedWithPreviousCheck(
  filterType: FilterType = FilterType.NotEqualTo,
): CriteriaFilter {
  return {
    checkOn: CheckOn.DnsRecordValue,
    filterType: filterType,
    value: undefined,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
    },
  };
}

describe("the window a DNS Record Value is offered", () => {
  test("the box is offered for it on a DNS monitor", () => {
    expect(
      CriteriaFilterUtil.isEvaluateOverTimeFilter(
        CheckOn.DnsRecordValue,
        MonitorType.DNS,
      ),
    ).toBe(true);
  });

  test("Previous Check is the only thing its window evaluates", () => {
    expect(
      values(
        CriteriaFilterUiUtil.getEvaluateOverTimeTypeOptions(
          comparedWithPreviousCheck(),
          MonitorType.DNS,
        ),
      ),
    ).toEqual([EvaluateOverTimeType.PreviousCheck]);
  });

  test("ticking the box starts it on Previous Check, Not Equal To: the answer changed", () => {
    const ticked: CriteriaFilter = CriteriaFilterUiUtil.setEvaluateOverTime({
      criteriaFilter: RECORD_VALUE,
      evaluateOverTime: true,
    });

    expect(ticked).toMatchObject({
      checkOn: CheckOn.DnsRecordValue,
      filterType: FilterType.NotEqualTo,
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 5,
        evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
      },
    });
    expect(
      CriteriaFilterUtil.isComparedWithPreviousCheck(ticked, MonitorType.DNS),
    ).toBe(true);
  });

  test("an Equal To it held is kept: the answer did not change", () => {
    expect(
      CriteriaFilterUiUtil.setEvaluateOverTime({
        criteriaFilter: { ...RECORD_VALUE, filterType: FilterType.EqualTo },
        evaluateOverTime: true,
      }).filterType,
    ).toBe(FilterType.EqualTo);
  });

  test("its window keeps the minutes and If No Data chosen, and nothing an answer cannot take", () => {
    const filter: CriteriaFilter = CriteriaFilterUiUtil.setEvaluateOverTimeType(
      {
        criteriaFilter: {
          ...RECORD_VALUE,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 15,
            evaluateOverTimeType: EvaluateOverTimeType.Count,
            onNoDataPolicy: NoDataPolicy.Trigger,
            countFilterType: FilterType.GreaterThan,
            countValue: 3,
            percentile: 99,
            changeType: PreviousCheckChangeType.Percentage,
            changeValue: 50,
          },
        },
        evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
        monitorType: MonitorType.DNS,
      },
    );

    expect(filter.evaluateOverTimeOptions).toEqual({
      timeValueInMinutes: 15,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
      onNoDataPolicy: NoDataPolicy.Trigger,
    });
    expect(filter.filterType).toBe(FilterType.NotEqualTo);
  });

  test("unticking it keeps the window, and the condition, for when it is ticked again", () => {
    const unticked: CriteriaFilter = CriteriaFilterUiUtil.setEvaluateOverTime({
      criteriaFilter: comparedWithPreviousCheck(FilterType.EqualTo),
      evaluateOverTime: false,
    });

    expect(unticked.evaluateOverTime).toBe(false);
    expect(unticked.filterType).toBe(FilterType.EqualTo);
    expect(unticked.evaluateOverTimeOptions?.evaluateOverTimeType).toBe(
      EvaluateOverTimeType.PreviousCheck,
    );
  });

  test("the Evaluate dropdown says what comparing a whole answer means", () => {
    expect(
      CriteriaFilterUiUtil.getEvaluateOverTimeTypeDescription(
        comparedWithPreviousCheck(),
        MonitorType.DNS,
      ),
    ).toBe(
      "The DNS answer is compared as a whole with the previous check's. Not Equal To matches when its records changed, Equal To when they did not. The same records in another order are no change.",
    );
  });

  test("every other check keeps the window it had", () => {
    const responseTime: CriteriaFilter =
      CriteriaFilterUiUtil.setEvaluateOverTime({
        criteriaFilter: {
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.GreaterThan,
          value: 500,
        },
        evaluateOverTime: true,
      });

    expect(responseTime.evaluateOverTimeOptions?.evaluateOverTimeType).toBe(
      EvaluateOverTimeType.AllValues,
    );
    expect(responseTime.filterType).toBe(FilterType.GreaterThan);
    expect(
      values(
        CriteriaFilterUiUtil.getEvaluateOverTimeTypeOptions(
          responseTime,
          MonitorType.DNS,
        ),
      ),
    ).toContain(EvaluateOverTimeType.Average);
  });
});

describe("the conditions a DNS Record Value is offered", () => {
  test("compared with the previous check: Not Equal To, then Equal To", () => {
    expect(
      values(
        CriteriaFilterUiUtil.getFilterTypeOptions({
          criteriaFilter: comparedWithPreviousCheck(),
          monitorType: MonitorType.DNS,
        }),
      ),
    ).toEqual([FilterType.NotEqualTo, FilterType.EqualTo]);
  });

  test("on the latest check alone, every condition it always had", () => {
    expect(
      values(
        CriteriaFilterUiUtil.getFilterTypeOptions({
          criteriaFilter: RECORD_VALUE,
          monitorType: MonitorType.DNS,
        }),
      ),
    ).toEqual(
      values(
        CriteriaFilterUiUtil.getFilterTypeOptionsByCheckOn(
          CheckOn.DnsRecordValue,
        ),
      ),
    );
    expect(
      values(
        CriteriaFilterUiUtil.getFilterTypeOptions({
          criteriaFilter: {
            ...comparedWithPreviousCheck(),
            evaluateOverTime: false,
          },
          monitorType: MonitorType.DNS,
        }),
      ),
    ).toContain(FilterType.Contains);
  });

  test("every other check, compared with the previous check or not, keeps its own", () => {
    const responseTime: CriteriaFilter = {
      checkOn: CheckOn.ResponseTime,
      filterType: FilterType.GreaterThan,
      value: undefined,
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 5,
        evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
      },
    };

    expect(
      values(
        CriteriaFilterUiUtil.getFilterTypeOptions({
          criteriaFilter: responseTime,
          monitorType: MonitorType.Website,
        }),
      ),
    ).toEqual(
      values(
        CriteriaFilterUiUtil.getFilterTypeOptionsByCheckOn(
          CheckOn.ResponseTime,
        ),
      ),
    );
  });

  test("no check, no conditions", () => {
    expect(
      CriteriaFilterUiUtil.getFilterTypeOptions({
        criteriaFilter: undefined,
        monitorType: MonitorType.DNS,
      }),
    ).toEqual([]);
  });
});

describe("the sentence that reads it back", () => {
  test("Not Equal To: different from the previous check, with no value and no change", () => {
    expect(
      CriteriaFilterUiUtil.translateFilterToText(
        comparedWithPreviousCheck(FilterType.NotEqualTo),
        MonitorType.DNS,
      ),
    ).toBe('Check if "DNS Record Value" is different from the previous check');
  });

  test("Equal To: the same as on the previous check", () => {
    expect(
      CriteriaFilterUiUtil.translateFilterToText(
        comparedWithPreviousCheck(FilterType.EqualTo),
        MonitorType.DNS,
      ),
    ).toBe('Check if "DNS Record Value" is the same as on the previous check');
  });

  test("a value written before the box was ticked is not read into it", () => {
    expect(
      CriteriaFilterUiUtil.translateFilterToText(
        {
          ...comparedWithPreviousCheck(FilterType.NotEqualTo),
          value: "93.184.216.34",
        },
        MonitorType.DNS,
      ),
    ).not.toContain("93.184.216.34");
  });
});
