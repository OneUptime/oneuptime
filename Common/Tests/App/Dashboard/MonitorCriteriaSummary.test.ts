import { describe, expect, test } from "@jest/globals";

import MonitorCriteriaSummaryUtil, {
  MAX_FILTERS_IN_SUMMARY,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorCriteriaSummary";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

/*
 * The criteria list collapses its rows now, so a row that cannot say what
 * its criteria DOES is a row the user has to expand to identify — which is
 * the thing collapsing was meant to avoid. Everything the collapsed row
 * shows is produced here, so it is pinned here.
 */

const OPERATIONAL_STATUS_ID: string = "11111111-1111-4111-8111-111111111111";
const OFFLINE_STATUS_ID: string = "22222222-2222-4222-8222-222222222222";

const MONITOR_STATUS_OPTIONS: Array<DropdownOption> = [
  { value: OPERATIONAL_STATUS_ID, label: "Operational" },
  { value: OFFLINE_STATUS_ID, label: "Offline" },
];

function filter(overrides: Partial<CriteriaFilter>): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseTime,
    filterType: FilterType.GreaterThan,
    value: "5000",
    ...overrides,
  } as CriteriaFilter;
}

function criteria(
  overrides: Partial<NonNullable<MonitorCriteriaInstance["data"]>>,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [],
    incidents: [],
    alerts: [],
    name: "Criteria",
    description: "Description",
    ...overrides,
  };

  return instance;
}

describe("MonitorCriteriaSummaryUtil.getFilterOperator", () => {
  test.each([
    [FilterType.EqualTo, "="],
    [FilterType.NotEqualTo, "≠"],
    [FilterType.GreaterThan, ">"],
    [FilterType.LessThan, "<"],
    [FilterType.GreaterThanOrEqualTo, "≥"],
    [FilterType.LessThanOrEqualTo, "≤"],
  ])(
    "renders %s as the symbol %s",
    (filterType: FilterType, symbol: string) => {
      expect(MonitorCriteriaSummaryUtil.getFilterOperator(filterType)).toBe(
        symbol,
      );
    },
  );

  test("keeps the wording of filter types that have no symbol", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterOperator(FilterType.Contains),
    ).toBe("contains");
    expect(
      MonitorCriteriaSummaryUtil.getFilterOperator(FilterType.StartsWith),
    ).toBe("starts with");
    expect(
      MonitorCriteriaSummaryUtil.getFilterOperator(FilterType.IsEmpty),
    ).toBe("is empty");
  });

  test("an unset filter type contributes nothing", () => {
    expect(MonitorCriteriaSummaryUtil.getFilterOperator(undefined)).toBe("");
  });
});

describe("MonitorCriteriaSummaryUtil.getFilterScope", () => {
  test("a disk-usage filter is scoped by its disk path", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterScope(
        filter({
          checkOn: CheckOn.DiskUsagePercent,
          serverMonitorOptions: { diskPath: "/dev/sda1" },
        }),
      ),
    ).toBe("/dev/sda1");
  });

  test("the every-disk wildcard is kept, not hidden", () => {
    /*
     * `*` is the difference between one alert for the monitor and one
     * alert per disk. A summary that dropped it would show a fan-out
     * criteria and a pinned one identically.
     */
    expect(
      MonitorCriteriaSummaryUtil.getFilterScope(
        filter({
          checkOn: CheckOn.DiskUsagePercent,
          serverMonitorOptions: { diskPath: "*" },
        }),
      ),
    ).toBe("*");
  });

  test("an SNMP OID filter is scoped by its OID", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterScope(
        filter({
          checkOn: CheckOn.SnmpOidValue,
          snmpMonitorOptions: { oid: "1.3.6.1.4.1.9.9.13.1.3.1.3" },
        }),
      ),
    ).toBe("1.3.6.1.4.1.9.9.13.1.3.1.3");
  });

  test("an SNMP interface filter is scoped by its interface name", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterScope(
        filter({
          checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
          snmpMonitorOptions: { interfaceName: "Gi0/1" },
        }),
      ),
    ).toBe("Gi0/1");
  });

  test("a metric filter is scoped by its metric alias", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterScope(
        filter({
          checkOn: CheckOn.MetricValue,
          metricMonitorOptions: { metricAlias: "cpu" },
        }),
      ),
    ).toBe("cpu");
  });

  test("a database-health filter is scoped by its metric type", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterScope(
        filter({
          checkOn: CheckOn.DatabaseMetric,
          databaseMonitorOptions: {
            metricType: MonitorMetricType.DatabaseConnectionsUsedPercent,
          },
        }),
      ),
    ).toBe(MonitorMetricType.DatabaseConnectionsUsedPercent);
  });

  test("blank and whitespace-only scopes are treated as unset", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterScope(
        filter({
          checkOn: CheckOn.DiskUsagePercent,
          serverMonitorOptions: { diskPath: "   " },
        }),
      ),
    ).toBeUndefined();
  });

  test("a check that names no entity has no scope", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterScope(
        filter({ checkOn: CheckOn.ResponseTime }),
      ),
    ).toBeUndefined();
  });
});

describe("MonitorCriteriaSummaryUtil.getFilterSummary", () => {
  test("a threshold filter reads as a comparison", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterSummary(
        filter({
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: "5000",
        }),
      ),
    ).toBe("Response Time (in ms) > 5000");
  });

  test("a boolean filter reads as 'is true' / 'is false'", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterSummary(
        filter({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        }),
      ),
    ).toBe("Is Online is true");

    expect(
      MonitorCriteriaSummaryUtil.getFilterSummary(
        filter({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        }),
      ),
    ).toBe("Is Online is false");
  });

  test("a boolean filter takes no value even if one was left behind", () => {
    /*
     * Switching a filter from a threshold check to a boolean one leaves
     * the old value on the object until the next change. It must not be
     * printed as though it were still compared against.
     */
    expect(
      MonitorCriteriaSummaryUtil.getFilterSummary(
        filter({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: "5000",
        }),
      ),
    ).toBe("Is Online is true");
  });

  test("the scope of a scoped check is part of the summary", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterSummary(
        filter({
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: "80",
          serverMonitorOptions: { diskPath: "/var" },
        }),
      ),
    ).toBe("Disk Usage (in %) [/var] ≥ 80");
  });

  test("two disk filters on the same criteria do not read identically", () => {
    const root: string = MonitorCriteriaSummaryUtil.getFilterSummary(
      filter({
        checkOn: CheckOn.DiskUsagePercent,
        serverMonitorOptions: { diskPath: "/" },
      }),
    );
    const data: string = MonitorCriteriaSummaryUtil.getFilterSummary(
      filter({
        checkOn: CheckOn.DiskUsagePercent,
        serverMonitorOptions: { diskPath: "/data" },
      }),
    );

    expect(root).not.toBe(data);
  });

  test("a threshold that has not been typed yet shows an ellipsis", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterSummary(
        filter({
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: undefined,
        }),
      ),
    ).toBe("Response Time (in ms) > …");
  });

  test("a numeric value survives the trip through the summary", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterSummary(
        filter({
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.EqualTo,
          value: 200,
        }),
      ),
    ).toBe("Response Status Code = 200");
  });

  test("an anomaly filter carries no threshold", () => {
    // Sensitivity lives in metricMonitorOptions, not in `value`.
    expect(
      MonitorCriteriaSummaryUtil.getFilterSummary(
        filter({
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.AnomalouslyHigh,
          value: undefined,
          metricMonitorOptions: { metricAlias: "cpu" },
        }),
      ),
    ).toBe("Metric Value [cpu] anomalously high");
  });

  test("an evaluate-over-time window is spelled out", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterSummary(
        filter({
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: "500",
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          },
        }),
      ),
    ).toBe("Response Time (in ms) > 500 (Average over 5m)");
  });

  test("evaluate-over-time options are ignored while the switch is off", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterSummary(
        filter({
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: "500",
          evaluateOverTime: false,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          },
        }),
      ),
    ).toBe("Response Time (in ms) > 500");
  });

  test("a filter with no check at all is called out as incomplete", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterSummary({
        checkOn: undefined,
        filterType: undefined,
        value: undefined,
      } as unknown as CriteriaFilter),
    ).toBe("Incomplete filter");

    expect(MonitorCriteriaSummaryUtil.getFilterSummary(undefined)).toBe(
      "Incomplete filter",
    );
  });

  test("a check with no condition still names the check", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFilterSummary(
        filter({
          checkOn: CheckOn.ResponseTime,
          filterType: undefined,
          value: undefined,
        }),
      ),
    ).toBe("Response Time (in ms)");
  });
});

describe("MonitorCriteriaSummaryUtil.getFiltersSummary", () => {
  test("ALL joins with 'and'", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFiltersSummary({
        filters: [
          filter({ checkOn: CheckOn.IsOnline, filterType: FilterType.True }),
          filter({
            checkOn: CheckOn.ResponseTime,
            filterType: FilterType.LessThan,
            value: "1000",
          }),
        ],
        filterCondition: FilterCondition.All,
      }),
    ).toBe("Is Online is true and Response Time (in ms) < 1000");
  });

  test("ANY joins with 'or'", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFiltersSummary({
        filters: [
          filter({ checkOn: CheckOn.IsOnline, filterType: FilterType.False }),
          filter({
            checkOn: CheckOn.ResponseTime,
            filterType: FilterType.GreaterThan,
            value: "9000",
          }),
        ],
        filterCondition: FilterCondition.Any,
      }),
    ).toBe("Is Online is false or Response Time (in ms) > 9000");
  });

  test("an unset condition is read as ALL, matching the form's own default", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFiltersSummary({
        filters: [
          filter({ checkOn: CheckOn.IsOnline, filterType: FilterType.True }),
          filter({ checkOn: CheckOn.IsOnline, filterType: FilterType.False }),
        ],
        filterCondition: undefined,
      }),
    ).toContain(" and ");
  });

  test("a long filter list is truncated so the row stays one line", () => {
    const summary: string = MonitorCriteriaSummaryUtil.getFiltersSummary({
      filters: [
        filter({ checkOn: CheckOn.IsOnline, filterType: FilterType.True }),
        filter({
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.LessThan,
          value: "1000",
        }),
        filter({
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.EqualTo,
          value: "200",
        }),
        filter({
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.Contains,
          value: "ok",
        }),
      ],
      filterCondition: FilterCondition.All,
    });

    expect(summary).toBe(
      "Is Online is true and Response Time (in ms) < 1000 (+2 more)",
    );
  });

  test("exactly the cutoff number of filters is spelled out in full", () => {
    const filters: Array<CriteriaFilter> = new Array(MAX_FILTERS_IN_SUMMARY)
      .fill(null)
      .map(() => {
        return filter({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
        });
      });

    expect(
      MonitorCriteriaSummaryUtil.getFiltersSummary({
        filters: filters,
        filterCondition: FilterCondition.All,
      }),
    ).not.toContain("more");
  });

  test("no filters says so", () => {
    expect(
      MonitorCriteriaSummaryUtil.getFiltersSummary({
        filters: [],
        filterCondition: FilterCondition.All,
      }),
    ).toBe("No filters");

    expect(
      MonitorCriteriaSummaryUtil.getFiltersSummary({
        filters: undefined,
        filterCondition: undefined,
      }),
    ).toBe("No filters");
  });
});

describe("MonitorCriteriaSummaryUtil.getActionSummaries", () => {
  test("a status change names the status it moves to", () => {
    expect(
      MonitorCriteriaSummaryUtil.getActionSummaries({
        criteriaInstance: criteria({
          changeMonitorStatus: true,
          monitorStatusId: new ObjectID(OFFLINE_STATUS_ID),
        }),
        monitorStatusOptions: MONITOR_STATUS_OPTIONS,
      }),
    ).toEqual(["Status → Offline"]);
  });

  test("a status change with no status picked is shown, not hidden", () => {
    /*
     * This is exactly the state that saves and then does nothing, so the
     * row has to admit to it rather than showing no action at all.
     */
    expect(
      MonitorCriteriaSummaryUtil.getActionSummaries({
        criteriaInstance: criteria({
          changeMonitorStatus: true,
          monitorStatusId: undefined,
        }),
        monitorStatusOptions: MONITOR_STATUS_OPTIONS,
      }),
    ).toEqual(["Status → not set"]);
  });

  test("a criteria saved before changeMonitorStatus existed still shows its status", () => {
    // Only the id is set; the flag predates those criteria.
    expect(
      MonitorCriteriaSummaryUtil.getActionSummaries({
        criteriaInstance: criteria({
          monitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID),
        }),
        monitorStatusOptions: MONITOR_STATUS_OPTIONS,
      }),
    ).toEqual(["Status → Operational"]);
  });

  test("alerts and incidents are counted", () => {
    expect(
      MonitorCriteriaSummaryUtil.getActionSummaries({
        criteriaInstance: criteria({
          createAlerts: true,
          alerts: [
            { title: "a", description: "", id: "1" },
            { title: "b", description: "", id: "2" },
          ],
          createIncidents: true,
          incidents: [{ title: "i", description: "", id: "3" }],
        }),
        monitorStatusOptions: MONITOR_STATUS_OPTIONS,
      }),
    ).toEqual(["2 alerts", "1 incident"]);
  });

  test("an action that is switched off contributes nothing", () => {
    expect(
      MonitorCriteriaSummaryUtil.getActionSummaries({
        criteriaInstance: criteria({
          createAlerts: false,
          alerts: [{ title: "a", description: "", id: "1" }],
          createIncidents: false,
          incidents: [{ title: "i", description: "", id: "2" }],
        }),
        monitorStatusOptions: MONITOR_STATUS_OPTIONS,
      }),
    ).toEqual([]);
  });

  test("a criteria with no data at all yields no actions", () => {
    expect(
      MonitorCriteriaSummaryUtil.getActionSummaries({
        criteriaInstance: undefined,
      }),
    ).toEqual([]);
  });
});

describe("MonitorCriteriaSummaryUtil.getCriteriaSummary", () => {
  test("reads as one sentence: what it looks for, and what it does", () => {
    expect(
      MonitorCriteriaSummaryUtil.getCriteriaSummary({
        criteriaInstance: criteria({
          filterCondition: FilterCondition.All,
          filters: [
            filter({
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.GreaterThan,
              value: "5000",
            }),
          ],
          changeMonitorStatus: true,
          monitorStatusId: new ObjectID(OFFLINE_STATUS_ID),
          createIncidents: true,
          incidents: [{ title: "Slow", description: "", id: "1" }],
        }),
        monitorStatusOptions: MONITOR_STATUS_OPTIONS,
      }),
    ).toBe("If Response Time (in ms) > 5000 → Status → Offline, 1 incident");
  });

  test("a criteria that does nothing says so", () => {
    expect(
      MonitorCriteriaSummaryUtil.getCriteriaSummary({
        criteriaInstance: criteria({
          filters: [
            filter({ checkOn: CheckOn.IsOnline, filterType: FilterType.True }),
          ],
        }),
        monitorStatusOptions: MONITOR_STATUS_OPTIONS,
      }),
    ).toBe("If Is Online is true → No actions");
  });

  test("an empty criteria still produces a readable line", () => {
    expect(
      MonitorCriteriaSummaryUtil.getCriteriaSummary({
        criteriaInstance: undefined,
      }),
    ).toBe("If No filters → No actions");
  });
});

describe("MonitorCriteriaSummaryUtil.isFirstMatchWins", () => {
  /*
   * Mirrors MonitorCriteriaEvaluator's fanOutAcrossCriteria. The form
   * tells the user whether reordering criteria changes anything, so a
   * drift between these two rules is a lie on screen.
   */

  test("an ordinary probe monitor stops at the first match", () => {
    expect(
      MonitorCriteriaSummaryUtil.isFirstMatchWins({
        monitorType: MonitorType.Website,
      }),
    ).toBe(true);
  });

  test("an incoming request monitor stops at the first match even when grouped", () => {
    expect(
      MonitorCriteriaSummaryUtil.isFirstMatchWins({
        monitorType: MonitorType.IncomingRequest,
        criteriaInstances: [
          criteria({
            incidentGrouping: { groupByJSONPath: "requestBody.alertname" },
          }),
        ],
      }),
    ).toBe(true);
  });

  test("a metric monitor with no group-by stops at the first match", () => {
    expect(
      MonitorCriteriaSummaryUtil.isFirstMatchWins({
        monitorType: MonitorType.Metrics,
        monitorStep: new MonitorStep(),
      }),
    ).toBe(true);
  });

  test("a metric monitor grouped by an attribute evaluates every criteria", () => {
    const monitorStep: MonitorStep = new MonitorStep();
    monitorStep.setMetricMonitor({
      ...MonitorStepMetricMonitorUtil.getDefault(),
      metricViewConfig: {
        queryConfigs: [
          {
            metricQueryData: {
              filterData: {},
              groupByAttributeKeys: ["host.name"],
            },
          },
        ],
        formulaConfigs: [],
      },
    });

    expect(
      MonitorCriteriaSummaryUtil.isFirstMatchWins({
        monitorType: MonitorType.Metrics,
        monitorStep: monitorStep,
      }),
    ).toBe(false);
  });

  test("a server monitor pinned to one disk stops at the first match", () => {
    expect(
      MonitorCriteriaSummaryUtil.isFirstMatchWins({
        monitorType: MonitorType.Server,
        criteriaInstances: [
          criteria({
            filters: [
              filter({
                checkOn: CheckOn.DiskUsagePercent,
                serverMonitorOptions: { diskPath: "/" },
              }),
            ],
          }),
        ],
      }),
    ).toBe(true);
  });

  test("a server monitor fanning out over every disk evaluates every criteria", () => {
    expect(
      MonitorCriteriaSummaryUtil.isFirstMatchWins({
        monitorType: MonitorType.Server,
        criteriaInstances: [
          criteria({
            filters: [
              filter({
                checkOn: CheckOn.DiskUsagePercent,
                serverMonitorOptions: { diskPath: "*" },
              }),
            ],
          }),
        ],
      }),
    ).toBe(false);
  });

  test("a network device fanning out over every interface evaluates every criteria", () => {
    expect(
      MonitorCriteriaSummaryUtil.isFirstMatchWins({
        monitorType: MonitorType.NetworkDevice,
        criteriaInstances: [
          criteria({
            filters: [
              filter({
                checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
                snmpMonitorOptions: { interfaceName: "*" },
              }),
            ],
          }),
        ],
      }),
    ).toBe(false);
  });

  test("a wildcard on a check that is not interface-scoped does not fan out", () => {
    expect(
      MonitorCriteriaSummaryUtil.isFirstMatchWins({
        monitorType: MonitorType.NetworkDevice,
        criteriaInstances: [
          criteria({
            filters: [
              filter({
                checkOn: CheckOn.SnmpOidValue,
                snmpMonitorOptions: { interfaceName: "*" },
              }),
            ],
          }),
        ],
      }),
    ).toBe(true);
  });
});

describe("MonitorCriteriaSummaryUtil.getEvaluationOrderHint", () => {
  test("a first-match-wins monitor is told that order matters", () => {
    const hint: string = MonitorCriteriaSummaryUtil.getEvaluationOrderHint({
      monitorType: MonitorType.Website,
    });

    expect(hint).toContain("first criteria that matches wins");
    expect(hint).toContain("Drag to reorder");
  });

  test("a per-series monitor is told that every criteria runs", () => {
    expect(
      MonitorCriteriaSummaryUtil.getEvaluationOrderHint({
        monitorType: MonitorType.Server,
        criteriaInstances: [
          criteria({
            filters: [
              filter({
                checkOn: CheckOn.DiskUsagePercent,
                serverMonitorOptions: { diskPath: "*" },
              }),
            ],
          }),
        ],
      }),
    ).toContain("Every criteria is checked");
  });
});
