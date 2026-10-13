import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import MonitorMetricTypeUtil from "../../../Utils/Monitor/MonitorMetricType";
import { describe, expect, test } from "@jest/globals";

/*
 * Which filters keep a match history (issue #4686): the checks that can be
 * evaluated over a period of time although nothing records them as a
 * series. On every check OneUptime writes whether such a filter matched,
 * and judges the window from that record (CriteriaFilterMatchHistory).
 *
 * CriteriaFilterUtil is the one place that says which ones they are: the
 * criteria form offers the checkbox from it and the evaluator decides how to
 * judge a filter from it. These tests pin the list, the rules derived from
 * it, and the guarantees the rest of the product relies on.
 */

const HTTP_MATCH_HISTORY_CHECK_ONS: Array<CheckOn> = [
  CheckOn.ResponseBody,
  CheckOn.ResponseHeader,
  CheckOn.ResponseHeaderValue,
  CheckOn.JavaScriptExpression,
  CheckOn.IsRequestTimeout,
];

const EXPECTED_MATCH_HISTORY: Array<{
  monitorType: MonitorType;
  checkOns: Array<CheckOn>;
}> = [
  { monitorType: MonitorType.Website, checkOns: HTTP_MATCH_HISTORY_CHECK_ONS },
  { monitorType: MonitorType.API, checkOns: HTTP_MATCH_HISTORY_CHECK_ONS },
  { monitorType: MonitorType.Ping, checkOns: [CheckOn.IsRequestTimeout] },
  { monitorType: MonitorType.IP, checkOns: [CheckOn.IsRequestTimeout] },
  { monitorType: MonitorType.Port, checkOns: [CheckOn.IsRequestTimeout] },
];

const MONITOR_TYPES_WITH_MATCH_HISTORY: Array<MonitorType> =
  EXPECTED_MATCH_HISTORY.map(
    (entry: { monitorType: MonitorType }): MonitorType => {
      return entry.monitorType;
    },
  );

function filter(
  checkOn: CheckOn,
  overrides: Partial<CriteriaFilter> = {},
): CriteriaFilter {
  const criteriaFilter: CriteriaFilter = {
    checkOn: checkOn,
    filterType: FilterType.Contains,
    value: "App Title",
    ...overrides,
  };

  return criteriaFilter;
}

describe("CriteriaFilterUtil.getMatchHistoryCheckOns", () => {
  test.each(EXPECTED_MATCH_HISTORY)(
    "$monitorType keeps a match history for exactly its yes/no checks",
    (entry: { monitorType: MonitorType; checkOns: Array<CheckOn> }) => {
      expect(
        CriteriaFilterUtil.getMatchHistoryCheckOns(entry.monitorType),
      ).toEqual(entry.checkOns);
    },
  );

  test("no other monitor type keeps one", () => {
    for (const monitorType of Object.values(MonitorType)) {
      if (MONITOR_TYPES_WITH_MATCH_HISTORY.includes(monitorType)) {
        continue;
      }

      expect({
        monitorType,
        checkOns: CriteriaFilterUtil.getMatchHistoryCheckOns(monitorType),
      }).toEqual({ monitorType, checkOns: [] });
    }
  });

  test("an unknown monitor type keeps none", () => {
    expect(CriteriaFilterUtil.getMatchHistoryCheckOns(undefined)).toEqual([]);
  });

  test("hands back a copy, so a caller cannot change the list", () => {
    const checkOns: Array<CheckOn> = CriteriaFilterUtil.getMatchHistoryCheckOns(
      MonitorType.Website,
    );

    checkOns.push(CheckOn.Error);
    checkOns.splice(0, 1);

    expect(
      CriteriaFilterUtil.getMatchHistoryCheckOns(MonitorType.Website),
    ).toEqual(HTTP_MATCH_HISTORY_CHECK_ONS);
  });
});

describe("CriteriaFilterUtil.hasMatchHistory", () => {
  test.each(EXPECTED_MATCH_HISTORY)(
    "every listed check of $monitorType has one",
    (entry: { monitorType: MonitorType; checkOns: Array<CheckOn> }) => {
      for (const checkOn of entry.checkOns) {
        expect(
          CriteriaFilterUtil.hasMatchHistory({
            checkOn: checkOn,
            monitorType: entry.monitorType,
          }),
        ).toBe(true);
      }
    },
  );

  test("the response body has one on Website and API monitors - the check #4686 asked about", () => {
    expect(
      CriteriaFilterUtil.hasMatchHistory({
        checkOn: CheckOn.ResponseBody,
        monitorType: MonitorType.Website,
      }),
    ).toBe(true);
    expect(
      CriteriaFilterUtil.hasMatchHistory({
        checkOn: CheckOn.ResponseBody,
        monitorType: MonitorType.API,
      }),
    ).toBe(true);
  });

  test("a JavaScript expression has none outside Website and API monitors", () => {
    /*
     * Incoming Request and Incoming Email monitors are checked when
     * something arrives, not on a schedule, so "every check over the last N
     * minutes" has no cadence to measure; SQL and Database expressions are
     * not switched on yet.
     */
    for (const monitorType of [
      MonitorType.IncomingRequest,
      MonitorType.IncomingEmail,
      MonitorType.SQLQuery,
      MonitorType.Database,
    ]) {
      expect(
        CriteriaFilterUtil.hasMatchHistory({
          checkOn: CheckOn.JavaScriptExpression,
          monitorType: monitorType,
        }),
      ).toBe(false);
    }
  });

  test("a request timeout has none on Domain monitors", () => {
    expect(
      CriteriaFilterUtil.hasMatchHistory({
        checkOn: CheckOn.IsRequestTimeout,
        monitorType: MonitorType.Domain,
      }),
    ).toBe(false);
  });

  test("a check with a series of its own never has one", () => {
    for (const checkOn of [
      CheckOn.IsOnline,
      CheckOn.ResponseStatusCode,
      CheckOn.ResponseTime,
    ]) {
      expect(
        CriteriaFilterUtil.hasMatchHistory({
          checkOn: checkOn,
          monitorType: MonitorType.Website,
        }),
      ).toBe(false);
    }
  });

  test("neither a missing check nor a missing monitor type has one", () => {
    expect(
      CriteriaFilterUtil.hasMatchHistory({
        checkOn: undefined,
        monitorType: MonitorType.Website,
      }),
    ).toBe(false);
    expect(
      CriteriaFilterUtil.hasMatchHistory({
        checkOn: CheckOn.ResponseBody,
        monitorType: undefined,
      }),
    ).toBe(false);
  });
});

describe("the match history list stays honest", () => {
  /*
   * A check with a series is judged from that series (EvaluateOverTime). If
   * one were also listed here it would be judged twice, by two different
   * rules, depending on which code path got to it first.
   */
  test("no check that keeps a match history has a series of its own", () => {
    for (const entry of EXPECTED_MATCH_HISTORY) {
      for (const checkOn of entry.checkOns) {
        expect({
          checkOn,
          series:
            MonitorMetricTypeUtil.getMonitorMetricTypeByCriteriaFilterOrNull(
              filter(checkOn),
            ),
        }).toEqual({ checkOn, series: null });
      }
    }
  });

  /*
   * "Every check over the last N minutes" is measured against the
   * monitor's schedule - how far apart its checks should be, what counts as
   * a gap in them (CriteriaFilterMatchHistory.judgeWindow): only monitors a
   * probe checks on their monitoring interval have one.
   */
  test("every monitor type that keeps a match history is checked on a schedule", () => {
    for (const monitorType of MONITOR_TYPES_WITH_MATCH_HISTORY) {
      expect({
        monitorType,
        scheduled: MonitorTypeHelper.isProbableMonitor(monitorType),
      }).toEqual({ monitorType, scheduled: true });
    }
  });

  test("every check that keeps a match history is a yes/no check", () => {
    for (const entry of EXPECTED_MATCH_HISTORY) {
      for (const checkOn of entry.checkOns) {
        expect(CriteriaFilterUtil.isJudgedCheckByCheck(checkOn)).toBe(true);
      }
    }
  });
});

describe("CriteriaFilterUtil.isJudgedCheckByCheck", () => {
  test.each([
    CheckOn.ResponseBody,
    CheckOn.ResponseHeader,
    CheckOn.ResponseHeaderValue,
    CheckOn.JavaScriptExpression,
    CheckOn.IsRequestTimeout,
    CheckOn.IsOnline,
    CheckOn.DnsIsOnline,
    CheckOn.NtpIsSynchronized,
  ])("%s is judged one check at a time", (checkOn: CheckOn) => {
    expect(CriteriaFilterUtil.isJudgedCheckByCheck(checkOn)).toBe(true);
  });

  test.each([
    CheckOn.ResponseTime,
    CheckOn.ResponseStatusCode,
    CheckOn.CPUUsagePercent,
    CheckOn.DnsResponseTime,
    CheckOn.MetricValue,
  ])("%s is a measured value, judged by aggregates too", (checkOn: CheckOn) => {
    expect(CriteriaFilterUtil.isJudgedCheckByCheck(checkOn)).toBe(false);
  });

  test("a missing check is not", () => {
    expect(CriteriaFilterUtil.isJudgedCheckByCheck(undefined)).toBe(false);
  });

  /*
   * The server judges a window check by check only where the check keeps a
   * match history. Elsewhere it compares the latest check, so the criteria
   * list must not describe a check-by-check wait there.
   */
  describe("with the monitor type", () => {
    test.each(EXPECTED_MATCH_HISTORY)(
      "every check that keeps a match history on a $monitorType monitor is",
      (entry: { monitorType: MonitorType; checkOns: Array<CheckOn> }) => {
        for (const checkOn of entry.checkOns) {
          expect(
            CriteriaFilterUtil.isJudgedCheckByCheck(checkOn, entry.monitorType),
          ).toBe(true);
        }
      },
    );

    test.each([
      [CheckOn.JavaScriptExpression, MonitorType.SQLQuery],
      [CheckOn.JavaScriptExpression, MonitorType.CustomJavaScriptCode],
      [CheckOn.JavaScriptExpression, MonitorType.IncomingRequest],
      [CheckOn.ResponseBody, MonitorType.SyntheticMonitor],
      [CheckOn.ResponseBody, MonitorType.Ping],
      [CheckOn.ResponseHeader, MonitorType.Port],
    ])(
      "%s on a %s monitor, which keeps no match history for it, is not",
      (checkOn: CheckOn, monitorType: MonitorType) => {
        expect(
          CriteriaFilterUtil.isJudgedCheckByCheck(checkOn, monitorType),
        ).toBe(false);
      },
    );

    test.each([MonitorType.SQLQuery, MonitorType.Server, MonitorType.Ping])(
      "a yes/no series is, on a %s monitor as anywhere",
      (monitorType: MonitorType) => {
        expect(
          CriteriaFilterUtil.isJudgedCheckByCheck(
            CheckOn.IsOnline,
            monitorType,
          ),
        ).toBe(true);
      },
    );

    test("a JavaScript expression on a SQL Query monitor keeps every aggregate, and an aggregate saved on it is kept as saved", () => {
      const expression: CriteriaFilter = filter(CheckOn.JavaScriptExpression, {
        filterType: FilterType.EvaluatesToTrue,
        value: "{{rowCount}} > 0",
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: EvaluateOverTimeType.Average,
        },
      });

      expect(
        CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
          expression,
          MonitorType.SQLQuery,
        ),
      ).toContain(EvaluateOverTimeType.Average);
      expect(
        CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
          expression,
          MonitorType.SQLQuery,
        ),
      ).toBe(EvaluateOverTimeType.Average);

      // On an API monitor the same filter is judged check by check.
      expect(
        CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
          expression,
          MonitorType.API,
        ),
      ).toEqual([
        EvaluateOverTimeType.AllValues,
        EvaluateOverTimeType.AnyValue,
      ]);
      expect(
        CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
          expression,
          MonitorType.API,
        ),
      ).toBe(EvaluateOverTimeType.AllValues);
    });
  });
});

describe("CriteriaFilterUtil.keepsMatchHistory", () => {
  test("with a monitor type, is hasMatchHistory", () => {
    expect(
      CriteriaFilterUtil.keepsMatchHistory(
        CheckOn.JavaScriptExpression,
        MonitorType.API,
      ),
    ).toBe(true);
    expect(
      CriteriaFilterUtil.keepsMatchHistory(
        CheckOn.JavaScriptExpression,
        MonitorType.SQLQuery,
      ),
    ).toBe(false);
  });

  test("without one, whether any monitor type keeps one for the check", () => {
    for (const checkOn of HTTP_MATCH_HISTORY_CHECK_ONS) {
      expect(CriteriaFilterUtil.keepsMatchHistory(checkOn)).toBe(true);
    }

    expect(CriteriaFilterUtil.keepsMatchHistory(CheckOn.IsOnline)).toBe(false);
    expect(CriteriaFilterUtil.keepsMatchHistory(CheckOn.ResponseTime)).toBe(
      false,
    );
    expect(CriteriaFilterUtil.keepsMatchHistory(undefined)).toBe(false);
  });
});

describe("CriteriaFilterUtil.getEvaluateOverTimeMinutes", () => {
  test.each([
    [5, 5],
    ["15", 15],
    [undefined, 0],
    [null, 0],
    ["", 0],
    [0, 0],
    [-5, 0],
    ["soon", 0],
  ])(
    "a window of %p minutes is %p",
    (timeValueInMinutes: unknown, expected: number) => {
      expect(
        CriteriaFilterUtil.getEvaluateOverTimeMinutes(
          filter(CheckOn.ResponseBody, {
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: timeValueInMinutes as number,
              evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            },
          }),
        ),
      ).toBe(expected);
    },
  );

  test("is 0 without a window", () => {
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeMinutes(
        filter(CheckOn.ResponseBody),
      ),
    ).toBe(0);
    expect(CriteriaFilterUtil.getEvaluateOverTimeMinutes(undefined)).toBe(0);
  });
});

/*
 * What everything that describes a filter asks before it describes a
 * window: the criteria list, the incident's expectation text.
 */
describe("CriteriaFilterUtil.isEvaluatedOverTime", () => {
  function withWindow(
    checkOn: CheckOn,
    timeValueInMinutes: unknown,
  ): CriteriaFilter {
    return filter(checkOn, {
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: timeValueInMinutes as number,
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      },
    });
  }

  test("a filter that keeps a match history is, with a window of some minutes", () => {
    expect(
      CriteriaFilterUtil.isEvaluatedOverTime(
        withWindow(CheckOn.ResponseBody, 5),
        MonitorType.Website,
      ),
    ).toBe(true);
  });

  test.each([undefined, 0, null, ""])(
    "a filter that keeps a match history is not with a window of %p minutes - it is judged on the latest check",
    (timeValueInMinutes: unknown) => {
      expect(
        CriteriaFilterUtil.isEvaluatedOverTime(
          withWindow(CheckOn.ResponseBody, timeValueInMinutes),
          MonitorType.Website,
        ),
      ).toBe(false);
      expect(
        CriteriaFilterUtil.isEvaluatedOverTime(
          withWindow(CheckOn.IsRequestTimeout, timeValueInMinutes),
          MonitorType.Ping,
        ),
      ).toBe(false);
    },
  );

  test("any other filter is whenever its box is ticked, as before", () => {
    expect(
      CriteriaFilterUtil.isEvaluatedOverTime(
        withWindow(CheckOn.ResponseTime, undefined),
        MonitorType.Website,
      ),
    ).toBe(true);
    // A JavaScript expression keeps no history on a SQL Query monitor.
    expect(
      CriteriaFilterUtil.isEvaluatedOverTime(
        withWindow(CheckOn.JavaScriptExpression, undefined),
        MonitorType.SQLQuery,
      ),
    ).toBe(true);
  });

  test("no filter is with its box unticked", () => {
    expect(
      CriteriaFilterUtil.isEvaluatedOverTime(
        filter(CheckOn.ResponseBody, {
          evaluateOverTime: false,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
        }),
        MonitorType.Website,
      ),
    ).toBe(false);
    expect(CriteriaFilterUtil.isEvaluatedOverTime(undefined)).toBe(false);
  });
});

describe("the evaluation types a check judged check by check is offered", () => {
  test.each([
    CheckOn.ResponseBody,
    CheckOn.ResponseHeader,
    CheckOn.ResponseHeaderValue,
    CheckOn.JavaScriptExpression,
  ])(
    "%s is offered All Values and Any Value only - an average of 'contained the text' means nothing",
    (checkOn: CheckOn) => {
      expect(
        CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
          filter(checkOn),
        ),
      ).toEqual([
        EvaluateOverTimeType.AllValues,
        EvaluateOverTimeType.AnyValue,
      ]);
    },
  );

  test("a measured value keeps every aggregate", () => {
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
        filter(CheckOn.ResponseTime, {
          filterType: FilterType.GreaterThan,
          value: 3000,
        }),
      ),
    ).toEqual([
      EvaluateOverTimeType.Average,
      EvaluateOverTimeType.Sum,
      EvaluateOverTimeType.MaximumValue,
      EvaluateOverTimeType.MunimumValue,
      EvaluateOverTimeType.AllValues,
      EvaluateOverTimeType.AnyValue,
    ]);
  });

  test.each([
    EvaluateOverTimeType.Average,
    EvaluateOverTimeType.Sum,
    EvaluateOverTimeType.MaximumValue,
    EvaluateOverTimeType.MunimumValue,
  ])(
    "a body filter saved with %s through the API is judged as All Values",
    (evaluateOverTimeType: EvaluateOverTimeType) => {
      expect(
        CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
          filter(CheckOn.ResponseBody, {
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 5,
              evaluateOverTimeType: evaluateOverTimeType,
            },
          }),
        ),
      ).toBe(EvaluateOverTimeType.AllValues);
    },
  );

  test("Any Value on a body filter is kept as saved", () => {
    expect(
      CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
        filter(CheckOn.ResponseBody, {
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
          },
        }),
      ),
    ).toBe(EvaluateOverTimeType.AnyValue);
  });

  test("an aggregate on a measured value is kept as saved", () => {
    expect(
      CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
        filter(CheckOn.ResponseTime, {
          filterType: FilterType.GreaterThan,
          value: 3000,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          },
        }),
      ),
    ).toBe(EvaluateOverTimeType.Average);
  });
});

describe("CriteriaFilterUtil.isEvaluateOverTimeFilter with a monitor type", () => {
  test.each(EXPECTED_MATCH_HISTORY)(
    "offers it for every check of $monitorType that keeps a match history",
    (entry: { monitorType: MonitorType; checkOns: Array<CheckOn> }) => {
      for (const checkOn of entry.checkOns) {
        expect(
          CriteriaFilterUtil.isEvaluateOverTimeFilter(
            checkOn,
            entry.monitorType,
          ),
        ).toBe(true);
      }
    },
  );

  test("without a monitor type, only the checks with a series are offered it, as before", () => {
    for (const checkOn of HTTP_MATCH_HISTORY_CHECK_ONS) {
      expect(CriteriaFilterUtil.isEvaluateOverTimeFilter(checkOn)).toBe(false);
    }

    expect(CriteriaFilterUtil.isEvaluateOverTimeFilter(CheckOn.IsOnline)).toBe(
      true,
    );
  });

  test("a check with a series is offered it whatever the monitor type", () => {
    for (const monitorType of [
      MonitorType.Website,
      MonitorType.Ping,
      MonitorType.Server,
      undefined,
    ]) {
      expect(
        CriteriaFilterUtil.isEvaluateOverTimeFilter(
          CheckOn.ResponseTime,
          monitorType,
        ),
      ).toBe(true);
    }
  });

  test("checks that keep no history are still not offered it", () => {
    expect(
      CriteriaFilterUtil.isEvaluateOverTimeFilter(
        CheckOn.JavaScriptExpression,
        MonitorType.SQLQuery,
      ),
    ).toBe(false);
    expect(
      CriteriaFilterUtil.isEvaluateOverTimeFilter(
        CheckOn.RequestBody,
        MonitorType.IncomingRequest,
      ),
    ).toBe(false);
    expect(
      CriteriaFilterUtil.isEvaluateOverTimeFilter(
        CheckOn.Error,
        MonitorType.SyntheticMonitor,
      ),
    ).toBe(false);
  });
});
