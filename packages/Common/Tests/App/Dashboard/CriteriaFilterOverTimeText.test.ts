import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil as CommonCriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * The Dashboard's side of issue #4686: how a filter judged from its match
 * history reads in the criteria list, the helpers the criteria form changes
 * its window with, and the promise the change makes - every filter of a
 * Website, API, Ping, IP or Port monitor can now be evaluated over a period
 * of time.
 */

function overTime(
  criteriaFilter: CriteriaFilter,
  type: EvaluateOverTimeType = EvaluateOverTimeType.AllValues,
  minutes: number = 5,
): CriteriaFilter {
  return {
    ...criteriaFilter,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: minutes,
      evaluateOverTimeType: type,
    },
  };
}

const BODY: CriteriaFilter = {
  checkOn: CheckOn.ResponseBody,
  filterType: FilterType.NotContains,
  value: "App Title",
};

const HEADER: CriteriaFilter = {
  checkOn: CheckOn.ResponseHeader,
  filterType: FilterType.Contains,
  value: "x-maintenance",
};

const HEADER_VALUE: CriteriaFilter = {
  checkOn: CheckOn.ResponseHeaderValue,
  filterType: FilterType.Contains,
  value: "starting",
};

const EXPRESSION: CriteriaFilter = {
  checkOn: CheckOn.JavaScriptExpression,
  filterType: FilterType.EvaluatesToTrue,
  value: "'{{responseBody.status}}' === 'starting'",
};

describe("the criteria list, for a filter judged from its match history", () => {
  test("a body filter says which checks it must match on, after what it checks", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        overTime(BODY),
        FilterCondition.All,
      ),
    ).toBe(
      'Check if "Response Body" not contains App Title on every check in the past 5 minutes and,',
    );
  });

  test("Any Value reads as any check", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        overTime(BODY, EvaluateOverTimeType.AnyValue, 15),
      ),
    ).toBe(
      'Check if "Response Body" not contains App Title on any check in the past 15 minutes ',
    );
  });

  test("an aggregate saved through the API reads as every check, as it is judged", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        overTime(BODY, EvaluateOverTimeType.Average),
      ),
    ).toBe(
      'Check if "Response Body" not contains App Title on every check in the past 5 minutes ',
    );
  });

  test("headers read the same way", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        overTime(HEADER),
        FilterCondition.Any,
      ),
    ).toBe(
      'Check if "Response Header" contains x-maintenance on every check in the past 5 minutes or,',
    );
    expect(
      CriteriaFilterUtil.translateFilterToText(
        overTime(HEADER_VALUE, undefined, 10),
      ),
    ).toBe(
      'Check if "Response Header Value" contains starting on every check in the past 10 minutes ',
    );
  });

  test("a JavaScript expression says its window before the full stop", () => {
    expect(CriteriaFilterUtil.translateFilterToText(overTime(EXPRESSION))).toBe(
      "Check if JavaScript expression '{{responseBody.status}}' === 'starting' - evaluates to true on every check in the past 5 minutes.",
    );
  });

  test("Is Request Timeout reads like the other true/false checks", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        overTime({
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.True,
          value: undefined,
        }),
      ),
    ).toBe(
      'Check if all values of "Is Request Timeout" in the past 5 minutes is true ',
    );
  });

  test("the same filters without a window read as before", () => {
    expect(CriteriaFilterUtil.translateFilterToText(BODY)).toBe(
      'Check if "Response Body" not contains App Title ',
    );
    expect(CriteriaFilterUtil.translateFilterToText(EXPRESSION)).toBe(
      "Check if JavaScript expression '{{responseBody.status}}' === 'starting' - evaluates to true.",
    );
  });

  test("a box ticked with no window set claims no window - the server judges the latest check", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText({
        ...BODY,
        evaluateOverTime: true,
      }),
    ).toBe('Check if "Response Body" not contains App Title ');
  });

  test("nor does a window without minutes - saved through the API, or with the dropdown cleared", () => {
    for (const timeValueInMinutes of [undefined, 0, null]) {
      const noMinutes: CriteriaFilter = {
        ...BODY,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: timeValueInMinutes as unknown as number,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          onNoDataPolicy: NoDataPolicy.Trigger,
        },
      };

      expect(
        CriteriaFilterUtil.translateFilterToText(
          noMinutes,
          undefined,
          MonitorType.Website,
        ),
      ).toBe('Check if "Response Body" not contains App Title ');
      expect(CriteriaFilterUtil.translateFilterToText(noMinutes)).toBe(
        'Check if "Response Body" not contains App Title ',
      );
    }
  });

  /*
   * Only the monitor types where the check keeps a match history judge its
   * window check by check; given the monitor, the list says so only there.
   */
  test("given the monitor type, a check-by-check window is described only where the monitor judges one", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        overTime(EXPRESSION),
        undefined,
        MonitorType.API,
      ),
    ).toBe(
      "Check if JavaScript expression '{{responseBody.status}}' === 'starting' - evaluates to true on every check in the past 5 minutes.",
    );

    expect(
      CriteriaFilterUtil.translateFilterToText(
        overTime(BODY),
        undefined,
        MonitorType.Website,
      ),
    ).toBe(
      'Check if "Response Body" not contains App Title on every check in the past 5 minutes ',
    );

    for (const monitorType of [
      MonitorType.SQLQuery,
      MonitorType.CustomJavaScriptCode,
      MonitorType.IncomingRequest,
    ]) {
      expect(
        CriteriaFilterUtil.translateFilterToText(
          overTime(EXPRESSION),
          undefined,
          monitorType,
        ),
      ).not.toContain("on every check");
    }
  });

  test("a measured value keeps its aggregate wording", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        overTime(
          {
            checkOn: CheckOn.ResponseTime,
            filterType: FilterType.GreaterThan,
            value: 3000,
          },
          EvaluateOverTimeType.Average,
        ),
      ),
    ).toContain('average value"Response Time (in ms)" in the past 5 minutes');
  });
});

describe("getCheckByCheckWindowText", () => {
  test("is empty for a filter without a window", () => {
    expect(CriteriaFilterUtil.getCheckByCheckWindowText(BODY)).toBe("");
    expect(CriteriaFilterUtil.getCheckByCheckWindowText(undefined)).toBe("");
  });

  test("is empty for a measured value and for a true/false series", () => {
    expect(
      CriteriaFilterUtil.getCheckByCheckWindowText(
        overTime({
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: 3000,
        }),
      ),
    ).toBe("");
    expect(
      CriteriaFilterUtil.getCheckByCheckWindowText(
        overTime({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        }),
      ),
    ).toBe("");
  });

  test("names the checks and the window otherwise", () => {
    expect(CriteriaFilterUtil.getCheckByCheckWindowText(overTime(BODY))).toBe(
      "on every check in the past 5 minutes ",
    );
    expect(
      CriteriaFilterUtil.getCheckByCheckWindowText(
        overTime(HEADER, EvaluateOverTimeType.AnyValue, 30),
      ),
    ).toBe("on any check in the past 30 minutes ");
  });

  test("is empty on a monitor type that keeps no match history for the check", () => {
    expect(
      CriteriaFilterUtil.getCheckByCheckWindowText(
        overTime(EXPRESSION),
        MonitorType.SQLQuery,
      ),
    ).toBe("");
    expect(
      CriteriaFilterUtil.getCheckByCheckWindowText(
        overTime(BODY),
        MonitorType.SyntheticMonitor,
      ),
    ).toBe("");
    expect(
      CriteriaFilterUtil.getCheckByCheckWindowText(
        overTime(EXPRESSION),
        MonitorType.API,
      ),
    ).toBe("on every check in the past 5 minutes ");
  });
});

describe("the form's window helpers", () => {
  test("ticking the box on a filter without a window gives it the default", () => {
    expect(
      CriteriaFilterUtil.setEvaluateOverTime({
        criteriaFilter: BODY,
        evaluateOverTime: true,
      }),
    ).toEqual({
      ...BODY,
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 5,
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      },
    });
  });

  test("the default is a copy - a filter never shares it", () => {
    const ticked: CriteriaFilter = CriteriaFilterUtil.setEvaluateOverTime({
      criteriaFilter: BODY,
      evaluateOverTime: true,
    });

    ticked.evaluateOverTimeOptions!.timeValueInMinutes = 60;

    expect(
      CriteriaFilterUtil.DEFAULT_EVALUATE_OVER_TIME_OPTIONS.timeValueInMinutes,
    ).toBe(5);
  });

  test("ticking the box keeps a window the filter already has", () => {
    const withWindow: CriteriaFilter = {
      ...overTime(BODY, EvaluateOverTimeType.AnyValue, 30),
      evaluateOverTime: false,
    };

    expect(
      CriteriaFilterUtil.setEvaluateOverTime({
        criteriaFilter: withWindow,
        evaluateOverTime: true,
      }).evaluateOverTimeOptions,
    ).toEqual({
      timeValueInMinutes: 30,
      evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
    });
  });

  test("unticking keeps the window", () => {
    expect(
      CriteriaFilterUtil.setEvaluateOverTime({
        criteriaFilter: overTime(BODY, EvaluateOverTimeType.AnyValue, 30),
        evaluateOverTime: false,
      }),
    ).toEqual({
      ...overTime(BODY, EvaluateOverTimeType.AnyValue, 30),
      evaluateOverTime: false,
    });
  });

  test("changing one setting keeps the others, and starts from the default", () => {
    expect(
      CriteriaFilterUtil.setEvaluateOverTimeOption({
        criteriaFilter: overTime(BODY, EvaluateOverTimeType.AnyValue, 30),
        change: { onNoDataPolicy: NoDataPolicy.Trigger },
      }).evaluateOverTimeOptions,
    ).toEqual({
      timeValueInMinutes: 30,
      evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
      onNoDataPolicy: NoDataPolicy.Trigger,
    });

    expect(
      CriteriaFilterUtil.setEvaluateOverTimeOption({
        criteriaFilter: BODY,
        change: { timeValueInMinutes: 15 },
      }),
    ).toEqual({
      ...BODY,
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 15,
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      },
    });
  });

  test("a saved window shows its option whether it was saved as a number or a string", () => {
    const fiveAsNumber: DropdownOption | undefined =
      CriteriaFilterUtil.getEvaluateOverTimeMinutesOption(5);
    const fiveAsString: DropdownOption | undefined =
      CriteriaFilterUtil.getEvaluateOverTimeMinutesOption("5");

    expect(fiveAsNumber?.value).toBe("5");
    expect(fiveAsString?.value).toBe("5");
    expect(fiveAsNumber?.label).toBe("5 Minutes");
  });

  test("a window the form does not offer, or none, shows no option", () => {
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeMinutesOption(7),
    ).toBeUndefined();
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeMinutesOption(undefined),
    ).toBeUndefined();
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeMinutesOption(""),
    ).toBeUndefined();
  });

  test("the Evaluate description fits the filter", () => {
    expect(CriteriaFilterUtil.getEvaluateOverTimeTypeDescription(BODY)).toBe(
      "All Values matches only when every check in the window matched. Any Value matches as soon as one check did.",
    );
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeTypeDescription({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        value: undefined,
      }),
    ).toBe(
      "All Values matches only when every check in the window matched. Any Value matches as soon as one check did.",
    );
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeTypeDescription({
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: 3000,
      }),
    ).toBe(
      "Average, Sum, Maximum Value and Minimum Value compare one figure for the whole window. All Values needs every check to meet the condition, Any Value just one.",
    );
  });

  test("the Evaluate description follows the monitor type", () => {
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeTypeDescription(
        EXPRESSION,
        MonitorType.API,
      ),
    ).toBe(
      "All Values matches only when every check in the window matched. Any Value matches as soon as one check did.",
    );
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeTypeDescription(
        EXPRESSION,
        MonitorType.SQLQuery,
      ),
    ).toBe(
      "Average, Sum, Maximum Value and Minimum Value compare one figure for the whole window. All Values needs every check to meet the condition, Any Value just one.",
    );
  });
});

/*
 * What the change promises: on the monitors a probe checks over HTTP, ICMP
 * or TCP, there is no filter left that has to fire on the one check that saw
 * it.
 */
describe("every filter of a Website, API, Ping, IP or Port monitor can wait", () => {
  test.each([
    MonitorType.Website,
    MonitorType.API,
    MonitorType.Ping,
    MonitorType.IP,
    MonitorType.Port,
  ])("every filter the %s criteria form offers", (monitorType: MonitorType) => {
    const offered: Array<CheckOn> =
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType).map(
        (option: DropdownOption): CheckOn => {
          return option.value as CheckOn;
        },
      );

    expect(offered.length).toBeGreaterThan(0);

    for (const checkOn of offered) {
      expect({
        checkOn,
        canWait: CommonCriteriaFilterUtil.isEvaluateOverTimeFilter(
          checkOn,
          monitorType,
        ),
      }).toEqual({ checkOn, canWait: true });
    }
  });

  test("and every check that keeps a match history is one the form offers", () => {
    for (const monitorType of [
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
    ]) {
      const offered: Array<unknown> =
        CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType).map(
          (option: DropdownOption): unknown => {
            return option.value;
          },
        );

      for (const checkOn of CommonCriteriaFilterUtil.getMatchHistoryCheckOns(
        monitorType,
      )) {
        expect({
          monitorType,
          checkOn,
          offered: offered.includes(checkOn),
        }).toEqual({ monitorType, checkOn, offered: true });
      }
    }
  });
});
