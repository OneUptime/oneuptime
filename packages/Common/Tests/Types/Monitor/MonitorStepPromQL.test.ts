import { JSONObject } from "../../../Types/JSON";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorStepMetricMonitor, {
  MetricMonitorQueryLanguage,
  MonitorStepMetricMonitorUtil,
  PROMQL_METRIC_ALIAS,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleReadResult,
} from "../../../Types/Monitor/TelemetryAlertRule";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricTelemetrySnapshot from "../../../Utils/Monitor/MetricTelemetrySnapshot";
import MonitorStepMetricQueries, {
  MonitorStepMetricReads,
} from "../../../Utils/Monitor/MonitorStepMetricQueries";
import MonitorStepMetricThresholds, {
  MonitorMetricThreshold,
  MonitorMetricThresholdSide,
} from "../../../Utils/Monitor/MonitorStepMetricThresholds";
import { describe, expect, test } from "@jest/globals";

/*
 * A Metrics monitor's step written in PromQL (issue #7712): stored beside
 * the builder's queries, which it keeps, and judged as its one expression,
 * series by series.
 */

const builderQuery: MetricQueryConfigData = {
  metricAliasData: {
    metricVariable: "a",
    title: "a",
    description: undefined,
    legend: undefined,
    legendUnit: undefined,
  },
  metricQueryData: {
    filterData: { metricName: "http.server.request.duration" },
  },
} as unknown as MetricQueryConfigData;

const promQLStep: (query: string) => MonitorStepMetricMonitor = (
  query: string,
): MonitorStepMetricMonitor => {
  return {
    queryLanguage: MetricMonitorQueryLanguage.PromQL,
    promQLQuery: query,
    metricViewConfig: { queryConfigs: [builderQuery], formulaConfigs: [] },
    rollingTime: RollingTime.Past5Minutes,
  };
};

const OPERATIONAL: ObjectID = new ObjectID(
  "0a000000-0000-4000-8000-000000000001",
);
const OFFLINE: ObjectID = new ObjectID("0a000000-0000-4000-8000-000000000003");

// A new Metrics monitor's first step, as the form seeds it, in PromQL.
const buildMonitorStep: (
  metricMonitor: MonitorStepMetricMonitor,
) => MonitorStep = (metricMonitor: MonitorStepMetricMonitor): MonitorStep => {
  const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    monitorType: MonitorType.Metrics,
    monitorName: "Errors",
    defaultMonitorStatusId: OPERATIONAL,
    onlineMonitorStatusId: OPERATIONAL,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });
  const step: MonitorStep = steps.data!.monitorStepsInstanceArray[0]!;
  step.setMetricMonitor(metricMonitor);
  return step;
};

const readRule: (step: MonitorStep) => TelemetryAlertRuleReadResult = (
  step: MonitorStep,
): TelemetryAlertRuleReadResult => {
  return TelemetryAlertRuleUtil.read({
    monitorType: MonitorType.Metrics,
    monitorStep: step,
    defaultMonitorStatusId: OPERATIONAL,
  });
};

describe("a step's query language", () => {
  test("a step is the builder's until it says PromQL", () => {
    expect(MonitorStepMetricMonitorUtil.isPromQL(undefined)).toBe(false);
    expect(
      MonitorStepMetricMonitorUtil.isPromQL(
        MonitorStepMetricMonitorUtil.getDefault(),
      ),
    ).toBe(false);
    expect(
      MonitorStepMetricMonitorUtil.isPromQL({
        ...promQLStep("up"),
        queryLanguage: MetricMonitorQueryLanguage.Builder,
      }),
    ).toBe(false);
    expect(MonitorStepMetricMonitorUtil.isPromQL(promQLStep("up"))).toBe(true);
  });

  test("the expression is read trimmed, and never as anything but text", () => {
    expect(
      MonitorStepMetricMonitorUtil.getPromQLQuery(promQLStep("  up == 0 \n")),
    ).toBe("up == 0");
    expect(
      MonitorStepMetricMonitorUtil.getPromQLQuery({
        ...promQLStep(""),
        promQLQuery: 5 as unknown as string,
      }),
    ).toBe("");
  });

  test("both survive the JSON a step is stored as, with the builder's queries", () => {
    const stored: JSONObject = MonitorStepMetricMonitorUtil.toJSON(
      promQLStep("sum(rate(x[5m]))"),
    );
    const read: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.fromJSON(
        JSON.parse(JSON.stringify(stored)) as JSONObject,
      );

    expect(read.queryLanguage).toBe(MetricMonitorQueryLanguage.PromQL);
    expect(read.promQLQuery).toBe("sum(rate(x[5m]))");
    expect(read.metricViewConfig.queryConfigs).toHaveLength(1);
    expect(
      read.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData
        .metricName,
    ).toBe("http.server.request.duration");
  });
});

describe("what a PromQL step is judged as", () => {
  test("one query, its expression, under the PromQL alias", () => {
    const viewConfig: MetricsViewConfig =
      MonitorStepMetricMonitorUtil.getEvaluatedViewConfig(
        promQLStep("up == 0"),
      );

    expect(viewConfig.formulaConfigs).toEqual([]);
    expect(viewConfig.queryConfigs).toHaveLength(1);
    expect(viewConfig.queryConfigs[0]!.metricAliasData?.metricVariable).toBe(
      PROMQL_METRIC_ALIAS,
    );
    // A root cause names the expression it compared.
    expect(viewConfig.queryConfigs[0]!.metricAliasData?.title).toBe("up == 0");
    // No metric of the builder's to read.
    expect(
      viewConfig.queryConfigs[0]!.metricQueryData.filterData.metricName,
    ).toBeUndefined();
  });

  test("the builder's own editor still reads the builder's queries", () => {
    expect(
      MonitorStepMetricMonitorUtil.getMetricViewConfig(promQLStep("up"))
        .queryConfigs,
    ).toEqual([builderQuery]);
    expect(
      MonitorStepMetricMonitorUtil.getEvaluatedViewConfig({
        ...promQLStep("up"),
        queryLanguage: MetricMonitorQueryLanguage.Builder,
      }).queryConfigs,
    ).toEqual([builderQuery]);
  });

  test("the criteria evaluator reads the expression, series by series", () => {
    const step: MonitorStep = buildMonitorStep(promQLStep("up == 0"));

    expect(
      MonitorStep.getMetricsViewConfig(step)?.queryConfigs[0]?.metricAliasData
        ?.metricVariable,
    ).toBe(PROMQL_METRIC_ALIAS);
    // Every series its own, though nothing is grouped by attributes.
    expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);
    expect(MonitorStep.isJudgedPerSeries(step)).toBe(true);
  });

  test("a builder step is per series only when it is grouped", () => {
    const step: MonitorStep = buildMonitorStep({
      ...promQLStep("up"),
      queryLanguage: MetricMonitorQueryLanguage.Builder,
    });

    expect(MonitorStep.isJudgedPerSeries(step)).toBe(false);

    step.setMetricMonitor({
      ...step.data!.metricMonitor!,
      metricViewConfig: {
        queryConfigs: [
          {
            ...builderQuery,
            metricQueryData: {
              ...builderQuery.metricQueryData,
              groupByAttributeKeys: ["host.name"],
            },
          },
        ],
        formulaConfigs: [],
      },
    });

    expect(MonitorStep.isJudgedPerSeries(step)).toBe(true);
  });
});

describe("a PromQL step is refused until its expression can run", () => {
  test.each([
    [
      "",
      "Write the PromQL expression this monitor evaluates, such as sum(rate(http_requests_total[5m])).",
    ],
    ["up[5m]", "The PromQL expression is a range vector"],
    ["sum(", "The PromQL expression does not parse: "],
  ])("%j", (query: string, message: string) => {
    expect(
      MonitorStep.getValidationError(
        buildMonitorStep(promQLStep(query)),
        MonitorType.Metrics,
      ),
    ).toContain(message);
  });

  test("an expression that runs passes", () => {
    expect(
      MonitorStep.getValidationError(
        buildMonitorStep(promQLStep("sum by (job) (rate(errors[5m])) > 1")),
        MonitorType.Metrics,
      ),
    ).toBeNull();
  });

  test("a builder step keeps whatever expression it holds unchecked", () => {
    expect(
      MonitorStep.getValidationError(
        buildMonitorStep({
          ...promQLStep("sum("),
          queryLanguage: MetricMonitorQueryLanguage.Builder,
        }),
        MonitorType.Metrics,
      ),
    ).toBeNull();
  });
});

describe("When to alert, on a PromQL step", () => {
  test("names the expression as the one thing a rule compares", () => {
    expect(
      TelemetryAlertRuleUtil.getMetricAliases(
        buildMonitorStep(promQLStep("up")),
      ),
    ).toEqual([PROMQL_METRIC_ALIAS]);
  });

  test("still reads as a rule when its criteria name a builder query", () => {
    const step: MonitorStep = buildMonitorStep(promQLStep("up"));
    const read: TelemetryAlertRuleReadResult = readRule(step);

    expect(read.problem).toBeNull();

    // A rule written while the step read the builder's query "a".
    const rule: TelemetryAlertRule = read.rule!;
    const written: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Metrics,
      monitorStep: step,
      rule: {
        ...rule,
        metricAlias: "a",
        filterType: FilterType.EqualTo,
        threshold: 0,
      },
    });

    expect(readRule(written).problem).toBeNull();
    expect(readRule(written).rule).toMatchObject({
      filterType: FilterType.EqualTo,
      threshold: 0,
    });

    // On a builder step without that query, the same criteria is no rule.
    written.setMetricMonitor({
      ...written.data!.metricMonitor!,
      queryLanguage: MetricMonitorQueryLanguage.Builder,
      metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    });
    expect(readRule(written).problem).not.toBeNull();
    written.setMetricMonitor({
      ...written.data!.metricMonitor!,
      queryLanguage: MetricMonitorQueryLanguage.PromQL,
    });
    // Writing the rule leaves the expression and its language as they were.
    expect(written.data?.metricMonitor?.promQLQuery).toBe("up");
    expect(written.data?.metricMonitor?.queryLanguage).toBe(
      MetricMonitorQueryLanguage.PromQL,
    );
    expect(
      written.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray[0]?.data
        ?.filters[0]?.checkOn,
    ).toBe(CheckOn.MetricValue);
  });

  test("offers no anomaly conditions: an expression has no hourly baseline", () => {
    const comparisons: Array<FilterType> =
      TelemetryAlertRuleUtil.getComparisons({
        monitorType: MonitorType.Metrics,
        isPromQL: true,
      });

    expect(comparisons).toContain(FilterType.GreaterThan);
    expect(comparisons).toContain(FilterType.ForecastAbove);
    expect(comparisons).not.toContain(FilterType.AnomalouslyHigh);
    expect(
      TelemetryAlertRuleUtil.getComparisons({
        monitorType: MonitorType.Metrics,
      }),
    ).toContain(FilterType.AnomalouslyHigh);
  });
});

/*
 * Issue #10227: what a PromQL step charts - on the monitor's Overview, on
 * the Criteria page and on the incidents and alerts it opens - is its
 * expression, for the services it reads, with the values its criteria
 * alert at drawn across it. Never the builder's queries the step keeps
 * from before it was switched.
 */
describe("what a PromQL step charts", () => {
  const SERVICE: ObjectID = new ObjectID(
    "0a000000-0000-4000-8000-0000000000aa",
  );

  const alertingStep: (data: {
    metricMonitor: MonitorStepMetricMonitor;
    alias?: string;
  }) => MonitorStep = (data: {
    metricMonitor: MonitorStepMetricMonitor;
    alias?: string;
  }): MonitorStep => {
    const step: MonitorStep = buildMonitorStep(data.metricMonitor);
    const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();

    criteria.data = {
      id: "errors-above-5",
      name: "Errors above 5",
      description: "",
      filterCondition: "Any" as never,
      filters: [
        {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
          value: 5,
          metricMonitorOptions: {
            metricAlias: data.alias || PROMQL_METRIC_ALIAS,
          },
        },
      ],
      incidents: [{ id: "i", title: "t", description: "d" } as never],
      alerts: [],
      createIncidents: true,
      createAlerts: false,
      changeMonitorStatus: true,
      monitorStatusId: OFFLINE,
    };

    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray = [criteria];

    return step;
  };

  const readsOf: (step: MonitorStep) => MonitorStepMetricReads | null = (
    step: MonitorStep,
  ): MonitorStepMetricReads | null => {
    return MonitorStepMetricQueries.getReads({
      monitorType: MonitorType.Metrics,
      monitorStep: step,
    });
  };

  test("reads the expression, trimmed, never the builder's queries it keeps", () => {
    const reads: MonitorStepMetricReads | null = readsOf(
      buildMonitorStep(promQLStep("  sum by (job) (rate(errors[5m])) \n")),
    );

    expect(reads?.promQLQuery).toBe("sum by (job) (rate(errors[5m]))");
    expect(reads?.queryConfigs).toEqual(
      MonitorStepMetricMonitorUtil.getPromQLViewConfig(
        "sum by (job) (rate(errors[5m]))",
      ).queryConfigs,
    );
    expect(reads?.formulaConfigs).toEqual([]);
    // Evaluated at each step of its window, as the worker evaluates it.
    expect(reads?.aggregatesWholeWindow).toBe(false);
    expect(reads?.rollingTime).toBe(RollingTime.Past5Minutes);
    expect(JSON.stringify(reads)).not.toContain("http.server.request.duration");
  });

  test("for the services the step reads, as the worker narrows it", () => {
    expect(
      readsOf(
        buildMonitorStep({
          ...promQLStep("up == 0"),
          telemetryServiceIds: [SERVICE],
        }),
      )?.telemetryServiceIds,
    ).toEqual([SERVICE.toString()]);
    expect(
      readsOf(buildMonitorStep(promQLStep("up == 0")))?.telemetryServiceIds,
    ).toEqual([]);
  });

  test("a builder step has no expression to chart, whatever it holds", () => {
    const reads: MonitorStepMetricReads | null = readsOf(
      buildMonitorStep({
        ...promQLStep("up == 0"),
        queryLanguage: MetricMonitorQueryLanguage.Builder,
      }),
    );

    expect(reads?.promQLQuery).toBeUndefined();
    expect(reads?.queryConfigs[0]?.metricQueryData.filterData.metricName).toBe(
      "http.server.request.duration",
    );
  });

  test("a PromQL step with no expression yet charts nothing", () => {
    expect(readsOf(buildMonitorStep(promQLStep("   ")))?.promQLQuery).toBe("");
  });

  test("the value its criteria alert at is a line on the expression", () => {
    const thresholds: Array<MonitorMetricThreshold> =
      MonitorStepMetricThresholds.getThresholds({
        monitorType: MonitorType.Metrics,
        monitorStep: alertingStep({ metricMonitor: promQLStep("up == 0") }),
        defaultMonitorStatusId: OPERATIONAL,
      });

    expect(thresholds).toHaveLength(1);
    expect(thresholds[0]).toMatchObject({
      criteriaId: "errors-above-5",
      metricVariable: PROMQL_METRIC_ALIAS,
      value: 5,
      breachSide: MonitorMetricThresholdSide.Above,
      onlyAtInterval: null,
    });
  });

  test("a criteria written while the step read the builder's query still draws on the expression", () => {
    expect(
      MonitorStepMetricThresholds.getThresholds({
        monitorType: MonitorType.Metrics,
        monitorStep: alertingStep({
          metricMonitor: promQLStep("up == 0"),
          alias: "a",
        }),
        defaultMonitorStatusId: OPERATIONAL,
      }).map((threshold: MonitorMetricThreshold): string => {
        return threshold.metricVariable;
      }),
    ).toEqual([PROMQL_METRIC_ALIAS]);
  });
});

describe("what an incident a PromQL step opened keeps to chart", () => {
  const WINDOW: InBetween<Date> = new InBetween<Date>(
    new Date("2026-11-05T05:39:00.000Z"),
    new Date("2026-11-05T05:44:00.000Z"),
  );

  const snapshotOf: (data: {
    queryConfigs: Array<MetricQueryConfigData>;
    telemetryType?: TelemetryType;
  }) => TelemetryQuery = (data: {
    queryConfigs: Array<MetricQueryConfigData>;
    telemetryType?: TelemetryType;
  }): TelemetryQuery => {
    return {
      telemetryType: data.telemetryType || TelemetryType.Metric,
      telemetryQuery: null,
      metricViewData: {
        startAndEndDate: WINDOW,
        queryConfigs: data.queryConfigs,
        formulaConfigs: [],
      },
    };
  };

  const expressionQuery: (query: string) => MetricQueryConfigData = (
    query: string,
  ): MetricQueryConfigData => {
    return MonitorStepMetricMonitorUtil.getPromQLViewConfig(query)
      .queryConfigs[0]!;
  };

  test("its snapshot's one query is the expression it evaluated", () => {
    expect(
      MetricTelemetrySnapshot.getPromQLQuery(
        snapshotOf({ queryConfigs: [expressionQuery(" up == 0 ")] }),
      ),
    ).toBe("up == 0");
    // As stored: the snapshot is JSON in the incident's row.
    expect(
      MetricTelemetrySnapshot.getPromQLQuery(
        JSON.parse(
          JSON.stringify(
            snapshotOf({ queryConfigs: [expressionQuery("up == 0")] }),
          ),
        ) as TelemetryQuery,
      ),
    ).toBe("up == 0");
  });

  test.each<[string, TelemetryQuery | null | undefined]>([
    ["no snapshot", null],
    ["a builder query", snapshotOf({ queryConfigs: [builderQuery] })],
    [
      "a query named like the expression that reads a metric",
      snapshotOf({
        queryConfigs: [
          {
            ...expressionQuery("up"),
            metricQueryData: {
              filterData: { metricName: "up" },
            },
          } as MetricQueryConfigData,
        ],
      }),
    ],
    [
      "two queries",
      snapshotOf({
        queryConfigs: [expressionQuery("up"), expressionQuery("up")],
      }),
    ],
    [
      "an expression with no text",
      snapshotOf({ queryConfigs: [expressionQuery("  ")] }),
    ],
    [
      "another query under the PromQL alias",
      snapshotOf({
        queryConfigs: [
          { ...expressionQuery("up"), id: "a" } as MetricQueryConfigData,
        ],
      }),
    ],
    [
      "a log snapshot",
      snapshotOf({
        queryConfigs: [expressionQuery("up")],
        telemetryType: TelemetryType.Log,
      }),
    ],
  ])(
    "%s is charted as before, not as an expression",
    (_name: string, snapshot: TelemetryQuery | null | undefined) => {
      expect(MetricTelemetrySnapshot.getPromQLQuery(snapshot)).toBeNull();
    },
  );
});
