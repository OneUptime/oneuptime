jest.mock("isolated-vm", () => {
  return {};
});

import LogMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/LogMonitorCriteria";
import LogCountBaselineService from "../../../../../Server/Services/LogCountBaselineService";
import LogGroupCriteriaFanOut from "../../../../../Server/Utils/Monitor/LogGroupCriteriaFanOut";
import MonitorCriteriaObservationBuilder from "../../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import LogMonitorResponse from "../../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import LogMonitorGroupResult, {
  LogMonitorGroupResultUtil,
} from "../../../../../Types/Monitor/LogMonitor/LogMonitorGroupResult";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import MetricSeriesFingerprint from "../../../../../Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Contract under test - how one LogCount filter reads a grouped Logs
 * monitor's response.
 *
 * Two readings exist. The whole-monitor verdict (which decides whether
 * the criteria is worth fanning out at all) holds when ANY group meets
 * the filter - the way a grouped metric filter holds when one series
 * does. The per-group verdict, on the narrowed copy the fan-out builds,
 * compares that one group's count and names the group in its message so
 * the alert says which tunnel it is about.
 */

function group(conName: string, logCount: number): LogMonitorGroupResult {
  const labels: { con_name: string } = { con_name: conName };

  return {
    fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
    labels: labels,
    logCount: logCount,
  };
}

function groupedResponse(
  groups: Array<LogMonitorGroupResult>,
  totalGroupCount?: number,
): LogMonitorResponse {
  return {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    logCount: groups.reduce((sum: number, item: LogMonitorGroupResult) => {
      return sum + item.logCount;
    }, 0),
    logQuery: {},
    groupByAttributes: ["con_name"],
    groupBreakdown: groups,
    totalGroupCount: totalGroupCount ?? groups.length,
  };
}

function logCountFilter(filterType: FilterType, value: number): CriteriaFilter {
  return { checkOn: CheckOn.LogCount, filterType: filterType, value: value };
}

function evaluate(
  response: LogMonitorResponse,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: response as DataToProcess,
    criteriaFilter: criteriaFilter,
  });
}

describe("LogMonitorCriteria - the whole-monitor verdict of a grouped monitor", () => {
  it("holds when one group meets the filter, and names that group", async () => {
    const result: string | null = await evaluate(
      groupedResponse([group("HQ-Branch1", 3), group("Branch2", 0)]),
      logCountFilter(FilterType.GreaterThan, 2),
    );

    expect(result).toContain("con_name = HQ-Branch1");
    expect(result).toContain("Log Count");
  });

  it("does not hold when no group meets the filter, even if the total would", async () => {
    // 3 + 3 = 6 > 5, but no single tunnel logged more than 5.
    expect(
      await evaluate(
        groupedResponse([group("HQ-Branch1", 3), group("Branch2", 3)]),
        logCountFilter(FilterType.GreaterThan, 5),
      ),
    ).toBeNull();
  });

  it("holds for a 'fewer than' filter one group meets, though the total does not", async () => {
    const result: string | null = await evaluate(
      groupedResponse([group("HQ-Branch1", 40), group("Branch2", 2)]),
      logCountFilter(FilterType.LessThan, 5),
    );

    expect(result).toContain("con_name = Branch2");
  });

  it("has no group to hold for when no log matched", async () => {
    for (const filter of [
      logCountFilter(FilterType.EqualTo, 0),
      logCountFilter(FilterType.LessThan, 1),
      logCountFilter(FilterType.GreaterThan, 0),
    ]) {
      expect(await evaluate(groupedResponse([]), filter)).toBeNull();
    }
  });

  it("names a group whose logs did not carry the attribute", async () => {
    const result: string | null = await evaluate(
      groupedResponse([group("", 4)]),
      logCountFilter(FilterType.GreaterThan, 0),
    );

    expect(result).toContain("con_name = (not set)");
  });
});

describe("LogMonitorCriteria - one group, judged alone", () => {
  it("compares that group's count and says which group it is", async () => {
    const response: LogMonitorResponse = groupedResponse([
      group("HQ-Branch1", 3),
      group("Branch2", 1),
    ]);

    const narrowed: LogMonitorResponse = LogGroupCriteriaFanOut.narrowToGroup({
      response: response,
      group: response.groupBreakdown![1]!,
    });

    expect(narrowed.logCount).toBe(1);
    expect(narrowed.groupBreakdown).toBeUndefined();

    const met: string | null = await evaluate(
      narrowed,
      logCountFilter(FilterType.GreaterThan, 0),
    );

    expect(met).toMatch(/^For con_name = Branch2: Log Count .*1/);

    expect(
      await evaluate(narrowed, logCountFilter(FilterType.GreaterThan, 2)),
    ).toBeNull();
  });

  it("leaves the response it narrowed untouched", () => {
    const response: LogMonitorResponse = groupedResponse([
      group("HQ-Branch1", 3),
    ]);

    LogGroupCriteriaFanOut.narrowToGroup({
      response: response,
      group: response.groupBreakdown![0]!,
    });

    expect(response.logCount).toBe(3);
    expect(response.groupBreakdown).toHaveLength(1);
    expect(response.evaluatedGroup).toBeUndefined();
  });
});

describe("LogMonitorCriteria - anomaly filters on a grouped monitor", () => {
  it("never matches, and never looks up the whole-monitor baseline", async () => {
    const getBaselineSpy: SpyInstance<
      typeof LogCountBaselineService.getBaseline
    > = jest.spyOn(LogCountBaselineService, "getBaseline");

    try {
      const response: LogMonitorResponse = groupedResponse([
        group("HQ-Branch1", 10000),
      ]);

      for (const filterType of [
        FilterType.AnomalouslyHigh,
        FilterType.AnomalouslyLow,
        FilterType.Anomalous,
      ]) {
        const filter: CriteriaFilter = {
          checkOn: CheckOn.LogCount,
          filterType: filterType,
          value: undefined,
        };

        expect(await evaluate(response, filter)).toBeNull();
        expect(
          await evaluate(
            LogGroupCriteriaFanOut.narrowToGroup({
              response: response,
              group: response.groupBreakdown![0]!,
            }),
            filter,
          ),
        ).toBeNull();
      }

      expect(getBaselineSpy).not.toHaveBeenCalled();
    } finally {
      getBaselineSpy.mockRestore();
    }
  });
});

describe("LogMonitorCriteria - an ungrouped monitor is unchanged", () => {
  it("compares the single count with no group in the message", async () => {
    const response: LogMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      logCount: 7,
      logQuery: {},
    };

    const result: string | null = await evaluate(
      response,
      logCountFilter(FilterType.GreaterThan, 5),
    );

    expect(result).toBeTruthy();
    expect(result).not.toContain("For ");
    expect(LogGroupCriteriaFanOut.isGroupedResponse(response)).toBe(false);
  });
});

describe("LogMonitorGroupResultUtil.describeGroup", () => {
  it("names every key in order", () => {
    expect(
      LogMonitorGroupResultUtil.describeGroup({
        con_name: "HQ-Branch1",
        gw_name: "WAN2",
      }),
    ).toBe("con_name = HQ-Branch1, gw_name = WAN2");
  });

  it("reads an empty or missing value as not set", () => {
    expect(
      LogMonitorGroupResultUtil.describeGroup({ con_name: "", gw_name: null }),
    ).toBe("con_name = (not set), gw_name = (not set)");
  });

  it("cuts a very long value", () => {
    const described: string = LogMonitorGroupResultUtil.describeGroup({
      message: "x".repeat(500),
    });

    expect(described.length).toBeLessThan(120);
    expect(described.endsWith("...")).toBe(true);
  });
});

describe("what the evaluation summary says about a grouped monitor", () => {
  function observe(
    response: LogMonitorResponse,
    criteriaFilter: CriteriaFilter,
  ): string | null {
    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.Logs;

    return MonitorCriteriaObservationBuilder.describeFilterObservation({
      monitor: monitor,
      criteriaFilter: criteriaFilter,
      dataToProcess: response as DataToProcess,
      monitorStep: new MonitorStep(),
    });
  }

  it("gives the total, the number of groups and the busiest group", () => {
    expect(
      observe(
        groupedResponse([group("HQ-Branch1", 5), group("Branch2", 1)]),
        logCountFilter(FilterType.GreaterThan, 10),
      ),
    ).toBe(
      "Log count was 6 across 2 groups; the most was 5, for con_name = HQ-Branch1.",
    );
  });

  it("says when the group cap left groups out", () => {
    expect(
      observe(
        groupedResponse([group("HQ-Branch1", 5), group("Branch2", 4)], 140),
        logCountFilter(FilterType.GreaterThan, 10),
      ),
    ).toBe(
      "Log count was 9 across 140 groups; the most was 5, for con_name = HQ-Branch1. Only the 2 groups with the most logs were evaluated.",
    );

    expect(
      observe(
        groupedResponse([group("HQ-Branch1", 5)], 3),
        logCountFilter(FilterType.GreaterThan, 10),
      ),
    ).toBe(
      "Log count was 5 across 3 groups; the most was 5, for con_name = HQ-Branch1. Only the group with the most logs was evaluated.",
    );
  });

  it("says there was no group when nothing matched", () => {
    expect(
      observe(groupedResponse([]), logCountFilter(FilterType.GreaterThan, 0)),
    ).toBe("No logs matched, so there was no group to evaluate.");
  });

  it("explains why an anomaly filter did not match", () => {
    expect(
      observe(groupedResponse([group("HQ-Branch1", 5)]), {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
      }),
    ).toContain("not evaluated per group");
  });

  it("names the group a per-group evaluation looked at", () => {
    const response: LogMonitorResponse = groupedResponse([group("Branch2", 1)]);

    expect(
      observe(
        LogGroupCriteriaFanOut.narrowToGroup({
          response: response,
          group: response.groupBreakdown![0]!,
        }),
        logCountFilter(FilterType.GreaterThan, 3),
      ),
    ).toBe("Log count for con_name = Branch2 was 1.");
  });

  it("is unchanged for an ungrouped monitor", () => {
    expect(
      observe(
        {
          projectId: ObjectID.generate(),
          monitorId: ObjectID.generate(),
          logCount: 4,
          logQuery: {},
        },
        logCountFilter(FilterType.GreaterThan, 10),
      ),
    ).toBe("Log count was 4.");
  });
});
