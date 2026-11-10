import { describe, expect, test } from "@jest/globals";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import { JSONObject } from "../../../Types/JSON";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance, {
  MonitorCriteriaInstanceType,
} from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  ProxmoxAlertTemplate,
  ProxmoxAlertTemplateArgs,
  getAllProxmoxAlertTemplates,
  getProxmoxAlertTemplateById,
} from "../../../Types/Monitor/ProxmoxAlertTemplates";
import {
  HostAlertTemplate,
  HostAlertTemplateArgs,
  getAllHostAlertTemplates,
} from "../../../Types/Monitor/HostAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import MonitorStepMetricQueries, {
  MonitorStepMetricReads,
} from "../../../Utils/Monitor/MonitorStepMetricQueries";
import MonitorStepMetricThresholds, {
  MonitorMetricThreshold,
  MonitorMetricThresholdOutcome,
  MonitorMetricThresholdSide,
} from "../../../Utils/Monitor/MonitorStepMetricThresholds";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * Issues #5759 and #6250: a chart of a monitor's metrics draws the values
 * its criteria compare them with. Only what a line can say honestly: an
 * alerting criteria's number, on the query or formula it compares, on the
 * scale the chart draws.
 */

const OFFLINE: string = "11111111-1111-4111-8111-111111111111";
const ONLINE: string = "22222222-2222-4222-8222-222222222222";
const DEGRADED: string = "33333333-3333-4333-8333-333333333333";

const queryOf: (data: {
  variable: string;
  aggregation?: MetricsAggregationType;
  transformAsRate?: boolean;
}) => MetricQueryConfigData = (data: {
  variable: string;
  aggregation?: MetricsAggregationType;
  transformAsRate?: boolean;
}): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: data.variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: `metric.${data.variable}`,
        aggegationType: data.aggregation || MetricsAggregationType.Avg,
      },
    },
    ...(data.transformAsRate ? { transformAsRate: true } : {}),
  } as unknown as MetricQueryConfigData;
};

const formulaOf: (
  variable: string,
  formula: string,
) => MetricFormulaConfigData = (
  variable: string,
  formula: string,
): MetricFormulaConfigData => {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricFormulaData: { metricFormula: formula },
  } as MetricFormulaConfigData;
};

const filterOf: (data: {
  filterType?: FilterType;
  value?: unknown;
  alias?: string | undefined;
  evaluation?: EvaluateOverTimeType;
  unit?: string;
  noData?: NoDataPolicy;
  checkOn?: CheckOn;
}) => CriteriaFilter = (data: {
  filterType?: FilterType;
  value?: unknown;
  alias?: string | undefined;
  evaluation?: EvaluateOverTimeType;
  unit?: string;
  noData?: NoDataPolicy;
  checkOn?: CheckOn;
}): CriteriaFilter => {
  return {
    checkOn: data.checkOn || CheckOn.MetricValue,
    filterType: data.filterType || FilterType.GreaterThan,
    value: (data.value === undefined ? 90 : data.value) as number,
    metricMonitorOptions: {
      ...(data.alias !== undefined ? { metricAlias: data.alias } : {}),
      ...(data.evaluation ? { metricAggregationType: data.evaluation } : {}),
      ...(data.unit ? { thresholdUnit: data.unit } : {}),
      ...(data.noData ? { onNoDataPolicy: data.noData } : {}),
    },
  };
};

const criteriaOf: (data: {
  id?: string;
  name?: string;
  filters: Array<CriteriaFilter>;
  incident?: boolean;
  alert?: boolean;
  statusId?: string | undefined;
  isEnabled?: boolean;
}) => MonitorCriteriaInstance = (data: {
  id?: string;
  name?: string;
  filters: Array<CriteriaFilter>;
  incident?: boolean;
  alert?: boolean;
  statusId?: string | undefined;
  isEnabled?: boolean;
}): MonitorCriteriaInstance => {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: data.id || ObjectID.generate().toString(),
    name: data.name === undefined ? "High CPU" : data.name,
    description: "",
    filterCondition: "Any" as MonitorCriteriaInstanceType["filterCondition"],
    filters: data.filters,
    incidents: data.incident
      ? [{ id: "i", title: "t", description: "d" } as never]
      : [],
    alerts: data.alert
      ? [{ id: "a", title: "t", description: "d" } as never]
      : [],
    createIncidents: Boolean(data.incident),
    createAlerts: Boolean(data.alert),
    changeMonitorStatus: Boolean(data.statusId),
    monitorStatusId: data.statusId ? new ObjectID(data.statusId) : undefined,
    ...(data.isEnabled === false ? { isEnabled: false } : {}),
  };

  return instance;
};

const stepOf: (data: {
  queryConfigs?: Array<MetricQueryConfigData>;
  formulaConfigs?: Array<MetricFormulaConfigData>;
  criteria: Array<MonitorCriteriaInstance>;
  rollingTime?: RollingTime | undefined;
  stepKey?: string;
  settings?: JSONObject | undefined;
}) => MonitorStep = (data: {
  queryConfigs?: Array<MetricQueryConfigData>;
  formulaConfigs?: Array<MetricFormulaConfigData>;
  criteria: Array<MonitorCriteriaInstance>;
  rollingTime?: RollingTime | undefined;
  stepKey?: string;
  settings?: JSONObject | undefined;
}): MonitorStep => {
  const step: MonitorStep = new MonitorStep();

  step.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: {
      data: { monitorCriteriaInstanceArray: data.criteria },
    },
    [data.stepKey || "metricMonitor"]: {
      ...(data.settings || {}),
      rollingTime: data.rollingTime || RollingTime.Past5Minutes,
      metricViewConfig: {
        queryConfigs: data.queryConfigs || [queryOf({ variable: "a" })],
        formulaConfigs: data.formulaConfigs || [],
      },
    },
  } as unknown as MonitorStep["data"];

  return step;
};

const thresholdsOf: (
  step: MonitorStep,
  options?: { monitorType?: MonitorType; criteriaIds?: Array<string> },
) => Array<MonitorMetricThreshold> = (
  step: MonitorStep,
  options?: { monitorType?: MonitorType; criteriaIds?: Array<string> },
): Array<MonitorMetricThreshold> => {
  return MonitorStepMetricThresholds.getThresholds({
    monitorType: options?.monitorType || MonitorType.Metrics,
    monitorStep: step,
    defaultMonitorStatusId: new ObjectID(ONLINE),
    criteriaIds: options?.criteriaIds,
  });
};

describe("a rule like 'CPU above 90'", () => {
  test("is a line at 90 on the CPU chart, above it the side that alerts", () => {
    const criteria: MonitorCriteriaInstance = criteriaOf({
      id: "rule",
      name: "High CPU",
      filters: [filterOf({ value: 90, alias: "a" })],
      incident: true,
      alert: true,
      statusId: OFFLINE,
    });

    expect(thresholdsOf(stepOf({ criteria: [criteria] }))).toEqual([
      {
        criteriaId: "rule",
        criteriaName: "High CPU",
        metricVariable: "a",
        value: 90,
        unit: undefined,
        filterType: FilterType.GreaterThan,
        breachSide: MonitorMetricThresholdSide.Above,
        isForecast: false,
        outcome: MonitorMetricThresholdOutcome.Incident,
        onlyAtInterval: null,
      },
    ]);
  });

  test.each([
    [FilterType.GreaterThan, MonitorMetricThresholdSide.Above],
    [FilterType.GreaterThanOrEqualTo, MonitorMetricThresholdSide.Above],
    [FilterType.LessThan, MonitorMetricThresholdSide.Below],
    [FilterType.LessThanOrEqualTo, MonitorMetricThresholdSide.Below],
    [FilterType.EqualTo, null],
    [FilterType.NotEqualTo, null],
  ])(
    "%s matches %s the line",
    (filterType: FilterType, side: MonitorMetricThresholdSide | null) => {
      const thresholds: Array<MonitorMetricThreshold> = thresholdsOf(
        stepOf({
          criteria: [
            criteriaOf({ filters: [filterOf({ filterType })], incident: true }),
          ],
        }),
      );

      expect(thresholds).toHaveLength(1);
      expect(thresholds[0]!.breachSide).toBe(side);
      expect(thresholds[0]!.isForecast).toBe(false);
    },
  );

  test("a forecast compares where the trend is headed: drawn, and said so", () => {
    const thresholds: Array<MonitorMetricThreshold> = thresholdsOf(
      stepOf({
        criteria: [
          criteriaOf({
            filters: [
              filterOf({ filterType: FilterType.ForecastAbove, value: 95 }),
              filterOf({ filterType: FilterType.ForecastBelow, value: 5 }),
            ],
            alert: true,
          }),
        ],
      }),
    );

    expect(
      thresholds.map((threshold: MonitorMetricThreshold) => {
        return [threshold.value, threshold.breachSide, threshold.isForecast];
      }),
    ).toEqual([
      [95, MonitorMetricThresholdSide.Above, true],
      [5, MonitorMetricThresholdSide.Below, true],
    ]);
  });

  test("a number written as text reads as the number; the unit it was typed in comes along", () => {
    const thresholds: Array<MonitorMetricThreshold> = thresholdsOf(
      stepOf({
        criteria: [
          criteriaOf({
            filters: [filterOf({ value: "512.5", unit: "MB" })],
            incident: true,
          }),
        ],
      }),
    );

    expect(thresholds[0]!.value).toBe(512.5);
    expect(thresholds[0]!.unit).toBe("MB");
  });
});

describe("what is not drawn", () => {
  test.each([
    ["an anomaly condition (it has no number)", FilterType.AnomalouslyHigh],
    ["a text comparison", FilterType.Contains],
    ["no comparison at all", undefined],
  ])("%s", (_name: string, filterType: FilterType | undefined) => {
    const filter: CriteriaFilter = filterOf({});
    filter.filterType = filterType;

    expect(
      thresholdsOf(
        stepOf({
          criteria: [criteriaOf({ filters: [filter], incident: true })],
        }),
      ),
    ).toEqual([]);
  });

  test.each([["not a number"], [""], [null], [Number.NaN], [Infinity]])(
    "a value of %p",
    (value: unknown) => {
      expect(
        thresholdsOf(
          stepOf({
            criteria: [
              criteriaOf({ filters: [filterOf({ value })], incident: true }),
            ],
          }),
        ),
      ).toEqual([]);
    },
  );

  test("a filter on something other than the metric's value", () => {
    expect(
      thresholdsOf(
        stepOf({
          criteria: [
            criteriaOf({
              filters: [filterOf({ checkOn: CheckOn.ResponseTime })],
              incident: true,
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("a recovery: back to the default status, opening nothing", () => {
    expect(
      thresholdsOf(
        stepOf({
          criteria: [
            criteriaOf({
              name: "Healthy",
              filters: [
                filterOf({
                  filterType: FilterType.LessThanOrEqualTo,
                  value: 85,
                }),
              ],
              statusId: ONLINE,
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("a switched-off criteria", () => {
    expect(
      thresholdsOf(
        stepOf({
          criteria: [
            criteriaOf({
              filters: [filterOf({})],
              incident: true,
              isEnabled: false,
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("a criteria that does nothing at all", () => {
    expect(
      thresholdsOf(
        stepOf({ criteria: [criteriaOf({ filters: [filterOf({})] })] }),
      ),
    ).toEqual([]);
  });

  test("a status change when the monitor's default status is not known", () => {
    expect(
      MonitorStepMetricThresholds.getThresholds({
        monitorType: MonitorType.Metrics,
        monitorStep: stepOf({
          criteria: [
            criteriaOf({ filters: [filterOf({})], statusId: DEGRADED }),
          ],
        }),
        defaultMonitorStatusId: undefined,
      }),
    ).toEqual([]);
  });

  test("a heartbeat that fires on silence: 'fewer than 0 samples' is a value no count reaches", () => {
    const heartbeat: CriteriaFilter = filterOf({
      filterType: FilterType.LessThan,
      value: 0,
      alias: "samples_received",
      noData: NoDataPolicy.Trigger,
    });

    const step: MonitorStep = stepOf({
      queryConfigs: [
        queryOf({
          variable: "samples_received",
          aggregation: MetricsAggregationType.Count,
        }),
      ],
      criteria: [criteriaOf({ filters: [heartbeat], incident: true })],
    });

    expect(thresholdsOf(step)).toEqual([]);

    // The same comparison on a gauge, or one a count can reach, is drawn.
    const reachable: MonitorStep = stepOf({
      queryConfigs: [
        queryOf({ variable: "up", aggregation: MetricsAggregationType.Min }),
        queryOf({ variable: "n", aggregation: MetricsAggregationType.Count }),
      ],
      criteria: [
        criteriaOf({
          filters: [
            filterOf({
              filterType: FilterType.LessThan,
              value: 0,
              alias: "up",
              noData: NoDataPolicy.Trigger,
            }),
            filterOf({
              filterType: FilterType.LessThanOrEqualTo,
              value: 0,
              alias: "n",
              noData: NoDataPolicy.Trigger,
            }),
          ],
          incident: true,
        }),
      ],
    });

    expect(
      thresholdsOf(reachable).map((threshold: MonitorMetricThreshold) => {
        return threshold.metricVariable;
      }),
    ).toEqual(["up", "n"]);
  });

  test("a window's sum, which is no value a chart of its minutes draws", () => {
    const sumOf: (rollingTime: RollingTime) => MonitorStep = (
      rollingTime: RollingTime,
    ): MonitorStep => {
      return stepOf({
        rollingTime,
        criteria: [
          criteriaOf({
            filters: [filterOf({ evaluation: EvaluateOverTimeType.Sum })],
            incident: true,
          }),
        ],
      });
    };

    expect(thresholdsOf(sumOf(RollingTime.Past5Minutes))).toEqual([]);
    // A one-minute window's sum is its one value.
    expect(thresholdsOf(sumOf(RollingTime.Past1Minute))).toHaveLength(1);
  });

  test("a query the chart draws as a rate, and a formula over one", () => {
    const step: MonitorStep = stepOf({
      queryConfigs: [
        queryOf({ variable: "a", transformAsRate: true }),
        queryOf({ variable: "b" }),
      ],
      formulaConfigs: [formulaOf("c", "a / b")],
      criteria: [
        criteriaOf({
          filters: [
            filterOf({ alias: "a" }),
            filterOf({ alias: "b", value: 10 }),
            filterOf({ alias: "c", value: 1 }),
          ],
          incident: true,
        }),
      ],
    });

    expect(
      thresholdsOf(step).map((threshold: MonitorMetricThreshold) => {
        return threshold.metricVariable;
      }),
    ).toEqual(["b"]);
  });

  test("a step with no queries, or no step", () => {
    expect(
      thresholdsOf(
        stepOf({
          queryConfigs: [],
          criteria: [criteriaOf({ filters: [filterOf({})], incident: true })],
        }),
      ),
    ).toEqual([]);
    expect(
      MonitorStepMetricThresholds.getThresholds({
        monitorType: MonitorType.Metrics,
        monitorStep: undefined,
      }),
    ).toEqual([]);
    expect(
      MonitorStepMetricThresholds.getThresholds({
        monitorType: MonitorType.Logs,
        monitorStep: stepOf({
          criteria: [criteriaOf({ filters: [filterOf({})], incident: true })],
        }),
      }),
    ).toEqual([]);
  });
});

describe("what a crossing does, and which line wins", () => {
  test("an incident, an alert, or a move away from the default status", () => {
    const step: MonitorStep = stepOf({
      criteria: [
        criteriaOf({
          name: "Warn",
          filters: [filterOf({ value: 70 })],
          statusId: DEGRADED,
        }),
        criteriaOf({
          name: "Page",
          filters: [filterOf({ value: 80 })],
          alert: true,
        }),
        criteriaOf({
          name: "Wake",
          filters: [filterOf({ value: 90 })],
          incident: true,
        }),
      ],
    });

    expect(
      thresholdsOf(step).map((threshold: MonitorMetricThreshold) => {
        return [threshold.criteriaName, threshold.outcome];
      }),
    ).toEqual([
      ["Wake", MonitorMetricThresholdOutcome.Incident],
      ["Page", MonitorMetricThresholdOutcome.Alert],
      ["Warn", MonitorMetricThresholdOutcome.StatusChange],
    ]);
  });

  test("two criteria on the same line draw it once, for the one that does the most", () => {
    const step: MonitorStep = stepOf({
      criteria: [
        criteriaOf({
          name: "Page",
          filters: [filterOf({ value: 90 })],
          alert: true,
        }),
        criteriaOf({
          name: "Wake",
          filters: [filterOf({ value: 90 })],
          incident: true,
        }),
        // The opposite side of the same number is a different line.
        criteriaOf({
          name: "Low",
          filters: [filterOf({ value: 90, filterType: FilterType.LessThan })],
          alert: true,
        }),
      ],
    });

    expect(
      thresholdsOf(step).map((threshold: MonitorMetricThreshold) => {
        return threshold.criteriaName;
      }),
    ).toEqual(["Wake", "Low"]);
  });

  test("a criteria's name is kept as written, trimmed", () => {
    expect(
      thresholdsOf(
        stepOf({
          criteria: [
            criteriaOf({
              name: "  Disk  ",
              filters: [filterOf({})],
              incident: true,
            }),
          ],
        }),
      )[0]!.criteriaName,
    ).toBe("Disk");
  });

  test("named criteria are drawn whatever they do: the one that opened an incident", () => {
    const step: MonitorStep = stepOf({
      criteria: [
        criteriaOf({
          id: "wake",
          filters: [filterOf({ value: 90 })],
          incident: true,
        }),
        criteriaOf({
          id: "healthy",
          name: "Healthy",
          filters: [filterOf({ value: 80, filterType: FilterType.LessThan })],
          statusId: ONLINE,
        }),
      ],
    });

    expect(
      thresholdsOf(step, { criteriaIds: ["healthy"] }).map(
        (threshold: MonitorMetricThreshold) => {
          return threshold.criteriaId;
        },
      ),
    ).toEqual(["healthy"]);
    expect(thresholdsOf(step, { criteriaIds: ["gone"] })).toEqual([]);
  });
});

describe("the query or formula a criteria compares", () => {
  const step: (alias: string | undefined) => Array<MonitorMetricThreshold> = (
    alias: string | undefined,
  ): Array<MonitorMetricThreshold> => {
    return thresholdsOf(
      stepOf({
        queryConfigs: [queryOf({ variable: "a" }), queryOf({ variable: "b" })],
        formulaConfigs: [formulaOf("c", "a / b * 100")],
        criteria: [
          criteriaOf({ filters: [filterOf({ alias })], incident: true }),
        ],
      }),
    );
  };

  test.each([
    ["a query its alias names", "b", "b"],
    ["a formula its alias names", "c", "c"],
    ["the first query, for an alias that names nothing", "zzz", "a"],
    ["the first query, for no alias", undefined, "a"],
    ["the first query, for an empty alias", "", "a"],
  ])("%s", (_name: string, alias: string | undefined, variable: string) => {
    expect(step(alias)[0]!.metricVariable).toBe(variable);
  });

  test("a query with no variable has no chart to draw the line on", () => {
    const query: MetricQueryConfigData = queryOf({ variable: "a" });
    query.metricAliasData = undefined;

    expect(
      thresholdsOf(
        stepOf({
          queryConfigs: [query],
          criteria: [criteriaOf({ filters: [filterOf({})], incident: true })],
        }),
      ),
    ).toEqual([]);
  });
});

describe("on the scale a chart draws", () => {
  const onlyAtIntervalOf: (data: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs?: Array<MetricFormulaConfigData>;
    alias: string;
    rollingTime?: RollingTime;
    settings?: JSONObject;
  }) => AggregationInterval | null | "not drawn" = (data: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs?: Array<MetricFormulaConfigData>;
    alias: string;
    rollingTime?: RollingTime;
    settings?: JSONObject;
  }): AggregationInterval | null | "not drawn" => {
    const thresholds: Array<MonitorMetricThreshold> = thresholdsOf(
      stepOf({
        queryConfigs: data.queryConfigs,
        formulaConfigs: data.formulaConfigs || [],
        rollingTime: data.rollingTime,
        settings: data.settings,
        criteria: [
          criteriaOf({
            filters: [filterOf({ alias: data.alias })],
            incident: true,
          }),
        ],
      }),
    );

    return thresholds[0] ? thresholds[0].onlyAtInterval : "not drawn";
  };

  test("an average, a gauge or a percentile holds on a chart of any range", () => {
    for (const aggregation of [
      MetricsAggregationType.Avg,
      MetricsAggregationType.Max,
      MetricsAggregationType.Min,
      MetricsAggregationType.P95,
    ]) {
      expect(
        onlyAtIntervalOf({
          queryConfigs: [queryOf({ variable: "a", aggregation })],
          alias: "a",
        }),
      ).toBeNull();
    }
  });

  test("a sum or a count holds only where each point covers what the monitor reads", () => {
    for (const aggregation of [
      MetricsAggregationType.Sum,
      MetricsAggregationType.Count,
    ]) {
      expect(
        onlyAtIntervalOf({
          queryConfigs: [queryOf({ variable: "a", aggregation })],
          alias: "a",
        }),
      ).toBe(AggregationInterval.Minute);
      expect(
        onlyAtIntervalOf({
          queryConfigs: [queryOf({ variable: "a", aggregation })],
          alias: "a",
          rollingTime: RollingTime.Past1Hours,
        }),
      ).toBe(AggregationInterval.FifteenMinutes);
    }
  });

  test("a share of two counts holds at any range; a count per something else does not", () => {
    const counts: Array<MetricQueryConfigData> = [
      queryOf({ variable: "failed", aggregation: MetricsAggregationType.Sum }),
      queryOf({ variable: "total", aggregation: MetricsAggregationType.Count }),
    ];

    expect(
      onlyAtIntervalOf({
        queryConfigs: counts,
        formulaConfigs: [formulaOf("share", "failed / total * 100")],
        alias: "share",
      }),
    ).toBeNull();
    expect(
      onlyAtIntervalOf({
        queryConfigs: counts,
        formulaConfigs: [formulaOf("perSecond", "failed / 60")],
        alias: "perSecond",
      }),
    ).toBe(AggregationInterval.Minute);
  });

  test("a step that reads its window whole: a share holds, a total never does", () => {
    const counts: Array<MetricQueryConfigData> = [
      queryOf({ variable: "failed", aggregation: MetricsAggregationType.Sum }),
      queryOf({ variable: "total", aggregation: MetricsAggregationType.Sum }),
    ];
    const settings: JSONObject = { aggregatesWholeWindow: true };

    expect(
      onlyAtIntervalOf({
        queryConfigs: counts,
        formulaConfigs: [formulaOf("share", "failed / total")],
        alias: "share",
        settings,
      }),
    ).toBeNull();
    expect(
      onlyAtIntervalOf({ queryConfigs: counts, alias: "failed", settings }),
    ).toBe("not drawn");

    // A whole window's sum is its one value: drawn on the share.
    expect(
      thresholdsOf(
        stepOf({
          queryConfigs: counts,
          formulaConfigs: [formulaOf("share", "failed / total")],
          settings,
          criteria: [
            criteriaOf({
              filters: [
                filterOf({
                  alias: "share",
                  evaluation: EvaluateOverTimeType.Sum,
                }),
              ],
              incident: true,
            }),
          ],
        }),
      ),
    ).toHaveLength(1);
  });

  test("a formula of formulas, or one that cannot be read, is taken to grow", () => {
    const queries: Array<MetricQueryConfigData> = [
      queryOf({ variable: "a", aggregation: MetricsAggregationType.Avg }),
    ];

    expect(
      MonitorStepMetricThresholds.scalesWithBucketWidth({
        metricVariable: "f2",
        queryConfigs: queries,
        formulaConfigs: [formulaOf("f1", "a * 2"), formulaOf("f2", "f1 / 2")],
      }),
    ).toBe(true);
    expect(
      MonitorStepMetricThresholds.scalesWithBucketWidth({
        metricVariable: "bad",
        queryConfigs: queries,
        formulaConfigs: [formulaOf("bad", "a +")],
      }),
    ).toBe(true);
    expect(
      MonitorStepMetricThresholds.scalesWithBucketWidth({
        metricVariable: "missing",
        queryConfigs: queries,
        formulaConfigs: [],
      }),
    ).toBe(true);
  });
});

describe("the out-of-the-box templates", () => {
  const proxmoxArgs: ProxmoxAlertTemplateArgs = {
    clusterIdentifier: "pve",
    onlineMonitorStatusId: new ObjectID(ONLINE),
    offlineMonitorStatusId: new ObjectID(OFFLINE),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "PVE",
  };

  test("High Node Memory: a line at 85 on the memory share, its Healthy criteria left out", () => {
    const template: ProxmoxAlertTemplate = getProxmoxAlertTemplateById(
      "pve-node-high-memory",
    )!;
    const step: MonitorStep = template.getMonitorStep(proxmoxArgs);

    const thresholds: Array<MonitorMetricThreshold> = thresholdsOf(step, {
      monitorType: MonitorType.Proxmox,
    });

    expect(thresholds).toHaveLength(1);
    expect(thresholds[0]).toMatchObject({
      criteriaName: "High Node Memory - Utilization > 85%",
      metricVariable: "node_memory_utilization",
      value: 85,
      breachSide: MonitorMetricThresholdSide.Above,
      outcome: MonitorMetricThresholdOutcome.Incident,
      onlyAtInterval: null,
    });
  });

  test("Stopped Reporting draws nothing: it fires on silence", () => {
    const template: ProxmoxAlertTemplate = getProxmoxAlertTemplateById(
      "pve-cluster-stopped-reporting",
    )!;

    expect(
      thresholdsOf(template.getMonitorStep(proxmoxArgs), {
        monitorType: MonitorType.Proxmox,
      }),
    ).toEqual([]);
  });

  test("every Proxmox and Host template: lines only on its own charts, never for Healthy", () => {
    const hostArgs: HostAlertTemplateArgs = {
      hostIdentifier: "web-01",
      onlineMonitorStatusId: new ObjectID(ONLINE),
      offlineMonitorStatusId: new ObjectID(OFFLINE),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Web",
    };

    const steps: Array<[MonitorType, MonitorStep]> = [
      ...getAllProxmoxAlertTemplates().map(
        (template: ProxmoxAlertTemplate): [MonitorType, MonitorStep] => {
          return [MonitorType.Proxmox, template.getMonitorStep(proxmoxArgs)];
        },
      ),
      ...getAllHostAlertTemplates().map(
        (template: HostAlertTemplate): [MonitorType, MonitorStep] => {
          return [MonitorType.Host, template.getMonitorStep(hostArgs)];
        },
      ),
    ];

    let drawn: number = 0;

    for (const [monitorType, step] of steps) {
      const reads: MonitorStepMetricReads = MonitorStepMetricQueries.getReads({
        monitorType,
        monitorStep: step,
      })!;
      const variables: Array<string> = [
        ...reads.queryConfigs,
        ...reads.formulaConfigs,
      ].map((config: MetricQueryConfigData | MetricFormulaConfigData) => {
        return config.metricAliasData?.metricVariable || "";
      });

      for (const threshold of thresholdsOf(step, { monitorType })) {
        drawn++;
        expect(variables).toContain(threshold.metricVariable);
        expect(threshold.criteriaName).not.toBe("Healthy");
        expect(Number.isFinite(threshold.value)).toBe(true);
      }
    }

    // Most templates are a threshold on a value: most draw a line.
    expect(drawn).toBeGreaterThan(steps.length / 2);
  });
});

describe("the step holding a criteria", () => {
  test("is found in whichever step holds it, and not at all once it is gone", () => {
    const first: MonitorStep = stepOf({
      criteria: [
        criteriaOf({ id: "one", filters: [filterOf({})], incident: true }),
      ],
    });
    const second: MonitorStep = stepOf({
      criteria: [
        criteriaOf({ id: "two", filters: [filterOf({})], incident: true }),
      ],
    });
    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: [first, second],
      defaultMonitorStatusId: new ObjectID(ONLINE),
    };

    expect(
      MonitorStepMetricThresholds.findStepOfCriteria({
        monitorSteps: steps,
        criteriaId: "two",
      }),
    ).toBe(second);
    expect(
      MonitorStepMetricThresholds.findStepOfCriteria({
        monitorSteps: steps,
        criteriaId: "gone",
      }),
    ).toBeNull();
    expect(
      MonitorStepMetricThresholds.findStepOfCriteria({
        monitorSteps: steps,
        criteriaId: "",
      }),
    ).toBeNull();
    expect(
      MonitorStepMetricThresholds.findStepOfCriteria({
        monitorSteps: undefined,
        criteriaId: "one",
      }),
    ).toBeNull();
  });
});

describe("whatever the criteria (seeded)", () => {
  const FILTER_TYPES: Array<FilterType> = [
    FilterType.GreaterThan,
    FilterType.GreaterThanOrEqualTo,
    FilterType.LessThan,
    FilterType.LessThanOrEqualTo,
    FilterType.EqualTo,
    FilterType.NotEqualTo,
    FilterType.ForecastAbove,
    FilterType.AnomalouslyHigh,
    FilterType.Contains,
  ];
  const AGGREGATIONS: Array<MetricsAggregationType> = [
    MetricsAggregationType.Avg,
    MetricsAggregationType.Sum,
    MetricsAggregationType.Count,
    MetricsAggregationType.Max,
  ];
  const STATUSES: Array<string | undefined> = [
    undefined,
    ONLINE,
    OFFLINE,
    DEGRADED,
  ];

  test("lines are on the step's own charts, each once, the most a crossing does first", () => {
    const random: SeededRandom = seededRandom(6250);

    for (let round: number = 0; round < 300; round++) {
      const queryCount: number = 1 + random(3);
      const queryConfigs: Array<MetricQueryConfigData> = [];
      for (let index: number = 0; index < queryCount; index++) {
        queryConfigs.push(
          queryOf({
            variable: `q${index}`,
            aggregation: AGGREGATIONS[random(AGGREGATIONS.length)]!,
          }),
        );
      }

      const formulaConfigs: Array<MetricFormulaConfigData> =
        random(2) === 0 ? [] : [formulaOf("f", "q0 / q0 * 100")];

      const criteria: Array<MonitorCriteriaInstance> = [];
      const criteriaCount: number = 1 + random(4);
      for (let index: number = 0; index < criteriaCount; index++) {
        const filters: Array<CriteriaFilter> = [];
        const filterCount: number = 1 + random(3);
        for (
          let filterIndex: number = 0;
          filterIndex < filterCount;
          filterIndex++
        ) {
          filters.push(
            filterOf({
              filterType: FILTER_TYPES[random(FILTER_TYPES.length)]!,
              value: random(3) === 0 ? "x" : random(5) * 10,
              alias: ["q0", "q1", "f", "zz", undefined][random(5)],
            }),
          );
        }

        criteria.push(
          criteriaOf({
            id: `c${index}`,
            filters,
            incident: random(3) === 0,
            alert: random(3) === 0,
            statusId: STATUSES[random(STATUSES.length)],
            isEnabled: random(6) !== 0,
          }),
        );
      }

      const step: MonitorStep = stepOf({
        queryConfigs,
        formulaConfigs,
        criteria,
      });
      const thresholds: Array<MonitorMetricThreshold> = thresholdsOf(step);

      const variables: Array<string> = [
        ...queryConfigs.map((query: MetricQueryConfigData) => {
          return query.metricAliasData!.metricVariable!;
        }),
        ...formulaConfigs.map((formula: MetricFormulaConfigData) => {
          return formula.metricAliasData.metricVariable!;
        }),
      ];

      const keys: Set<string> = new Set<string>();
      let lastRank: number = -1;
      const rankOf: Record<MonitorMetricThresholdOutcome, number> = {
        [MonitorMetricThresholdOutcome.Incident]: 0,
        [MonitorMetricThresholdOutcome.Alert]: 1,
        [MonitorMetricThresholdOutcome.StatusChange]: 2,
      };

      for (const threshold of thresholds) {
        expect(variables).toContain(threshold.metricVariable);
        expect(Number.isFinite(threshold.value)).toBe(true);

        const instance: MonitorCriteriaInstance = criteria.find(
          (candidate: MonitorCriteriaInstance) => {
            return candidate.data!.id === threshold.criteriaId;
          },
        )!;
        expect(instance.data!.isEnabled).not.toBe(false);
        expect(
          MonitorStepMetricThresholds.isAlertingCriteria(
            instance.data!,
            new ObjectID(ONLINE),
          ),
        ).toBe(true);
        expect(threshold.outcome).toBe(
          MonitorStepMetricThresholds.getOutcome(instance.data!),
        );

        const key: string = JSON.stringify([
          threshold.metricVariable,
          threshold.value,
          threshold.breachSide,
          threshold.isForecast,
          threshold.filterType === FilterType.NotEqualTo,
        ]);
        expect(keys.has(key)).toBe(false);
        keys.add(key);

        expect(rankOf[threshold.outcome]).toBeGreaterThanOrEqual(lastRank);
        lastRank = rankOf[threshold.outcome];
      }
    }
  });
});
