import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import MonitorStepMetricQueries from "Common/Utils/Monitor/MonitorStepMetricQueries";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  RootCauseMetrics,
  RootCauseMonitor,
  getRootCauseMetrics,
} from "../../FeatureSet/Dashboard/src/Utils/IncidentRootCauseMetrics";

/*
 * What an incident's Root Cause page charts (issue #6249): the metric
 * investigation its Overview shows, beside the root cause. What the
 * incident kept of the check that opened it when it kept a metric
 * snapshot - exactly what the Overview charts - and otherwise its
 * monitor's metrics as the monitor reads them now (an incident declared by
 * hand on a metric monitor, or one opened before incidents kept a
 * snapshot), which the card says. Nothing for an incident with no metrics
 * behind it.
 */

const RULE_ID: string = "rule-1";

function queryOf(data: {
  variable?: string;
  metricName?: string;
  attributes?: Dictionary<unknown>;
  groupBy?: Array<string>;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: data.variable || "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName === undefined ? "cpu" : data.metricName,
        aggegationType: MetricsAggregationType.Avg,
        ...(data.attributes ? { attributes: data.attributes } : {}),
      } as never,
      ...(data.groupBy ? { groupByAttributeKeys: data.groupBy } : {}),
    },
  };
}

const FORMULA: MetricFormulaConfigData = {
  metricAliasData: {
    metricVariable: "f",
    title: "",
    description: "",
    legend: "",
    legendUnit: "",
  },
  metricFormulaData: { metricFormula: "a * 100" },
};

function ruleOf(id: string): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = { id: id } as unknown as MonitorCriteriaInstance["data"];
  return instance;
}

interface StepData {
  settings?: Dictionary<unknown>;
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs?: Array<MetricFormulaConfigData>;
  criteriaIds?: Array<string>;
}

function monitorOf(
  monitorType: MonitorType,
  steps: Array<StepData>,
): RootCauseMonitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  const stepKey: string =
    (MonitorStepMetricQueries.getStepKey(monitorType) as string) ||
    "metricMonitor";

  monitorSteps.data = {
    monitorStepsInstanceArray: steps.map(
      (data: StepData, index: number): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.data = {
          id: `step-${index}`,
          monitorCriteria: {
            data: {
              monitorCriteriaInstanceArray: (data.criteriaIds || []).map(
                ruleOf,
              ),
            },
          },
          [stepKey]: {
            ...(data.settings || {}),
            metricViewConfig: {
              queryConfigs: data.queryConfigs,
              formulaConfigs: data.formulaConfigs || [],
            },
          },
        } as unknown as MonitorStep["data"];
        return step;
      },
    ),
  } as unknown as MonitorSteps["data"];

  return { monitorType: monitorType, monitorSteps: monitorSteps };
}

const EVALUATED: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-05T05:39:00.000Z"),
  new Date("2026-11-05T05:44:00.000Z"),
);

function metricSnapshot(
  queryConfigs: Array<MetricQueryConfigData>,
  extra?: Partial<TelemetryQuery>,
): TelemetryQuery {
  return {
    telemetryType: TelemetryType.Metric,
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: EVALUATED,
      queryConfigs: queryConfigs,
      formulaConfigs: [FORMULA],
    },
    ...(extra || {}),
  };
}

function attributesOf(
  metrics: RootCauseMetrics | null,
  index: number = 0,
): unknown {
  return metrics?.telemetryQuery.metricViewData?.queryConfigs[index]
    ?.metricQueryData.filterData.attributes;
}

function metricNamesOf(metrics: RootCauseMetrics | null): Array<string> {
  return (metrics?.telemetryQuery.metricViewData?.queryConfigs || []).map(
    (queryConfig: MetricQueryConfigData): string => {
      return String(queryConfig.metricQueryData.filterData.metricName);
    },
  );
}

const SERIES: JSONObject = { "resource.host.name": "prod-01" };

describe("an incident that kept a metric snapshot: what its Overview charts", () => {
  test("the snapshot, with what the monitor evaluated, and no note", () => {
    const snapshot: TelemetryQuery = metricSnapshot([queryOf({})]);

    const metrics: RootCauseMetrics | null = getRootCauseMetrics({
      telemetryQuery: snapshot,
      seriesLabels: null,
      monitors: [],
    });

    expect(metrics).not.toBeNull();
    expect(metrics!.telemetryQuery.telemetryType).toBe(TelemetryType.Metric);
    // Nothing to narrow: the very view the incident kept.
    expect(metrics!.telemetryQuery.metricViewData).toBe(
      snapshot.metricViewData,
    );
    expect(metrics!.evaluationWindow?.startValue.toISOString()).toBe(
      "2026-11-05T05:39:00.000Z",
    );
    expect(metrics!.evaluationWindow?.endValue.toISOString()).toBe(
      "2026-11-05T05:44:00.000Z",
    );
    expect(metrics!.seriesSummary).toBe("");
    expect(metrics!.chartedFromMonitorNow).toBeUndefined();
  });

  test("narrowed to the incident's own series, as its Overview narrows it, and says so", () => {
    const metrics: RootCauseMetrics | null = getRootCauseMetrics({
      telemetryQuery: metricSnapshot([
        queryOf({ groupBy: ["resource.host.name"] }),
      ]),
      seriesLabels: SERIES,
      monitors: [],
    });

    expect(attributesOf(metrics)).toEqual({ "resource.host.name": "prod-01" });
    expect(metrics!.seriesSummary).toBe("resource.host.name = prod-01");
    // The formulas and the window are the snapshot's.
    expect(metrics!.telemetryQuery.metricViewData?.formulaConfigs).toEqual([
      FORMULA,
    ]);
    expect(metrics!.telemetryQuery.metricViewData?.startAndEndDate).toBe(
      EVALUATED,
    );
  });

  test("a label the queries never grouped by narrows nothing, and is not claimed", () => {
    const metrics: RootCauseMetrics | null = getRootCauseMetrics({
      telemetryQuery: metricSnapshot([queryOf({})]),
      seriesLabels: SERIES,
      monitors: [],
    });

    expect(attributesOf(metrics)).toBeUndefined();
    expect(metrics!.seriesSummary).toBe("");
  });

  test("what the snapshot keeps beside its queries is kept: the monitor's scopes and services", () => {
    const snapshot: TelemetryQuery = metricSnapshot([queryOf({})], {
      metricQueryScopes: [{ "resource.k8s.cluster.name": "prod" }],
      metricServiceIds: ["service-1"],
    });

    const metrics: RootCauseMetrics | null = getRootCauseMetrics({
      telemetryQuery: snapshot,
      seriesLabels: null,
      monitors: [],
    });

    expect(metrics!.telemetryQuery.metricQueryScopes).toEqual([
      { "resource.k8s.cluster.name": "prod" },
    ]);
    expect(metrics!.telemetryQuery.metricServiceIds).toEqual(["service-1"]);
  });

  test("a window whose bounds came back as ISO strings is read as Dates", () => {
    const metrics: RootCauseMetrics | null = getRootCauseMetrics({
      telemetryQuery: {
        ...metricSnapshot([queryOf({})]),
        metricViewData: {
          startAndEndDate: new InBetween<Date>(
            "2026-11-05T05:39:00.000Z" as unknown as Date,
            "2026-11-05T05:44:00.000Z" as unknown as Date,
          ),
          queryConfigs: [queryOf({})],
          formulaConfigs: [],
        },
      },
      seriesLabels: null,
      monitors: [],
    });

    expect(metrics!.evaluationWindow?.startValue).toBeInstanceOf(Date);
    expect(metrics!.evaluationWindow?.endValue.toISOString()).toBe(
      "2026-11-05T05:44:00.000Z",
    );
  });

  test("the snapshot wins over the monitor as it is now, which may have changed since", () => {
    const metrics: RootCauseMetrics | null = getRootCauseMetrics({
      telemetryQuery: metricSnapshot([queryOf({ metricName: "cpu" })]),
      seriesLabels: null,
      createdCriteriaId: RULE_ID,
      monitors: [
        monitorOf(MonitorType.Metrics, [
          {
            queryConfigs: [queryOf({ metricName: "memory" })],
            criteriaIds: [RULE_ID],
          },
        ]),
      ],
    });

    expect(metricNamesOf(metrics)).toEqual(["cpu"]);
    expect(metrics!.chartedFromMonitorNow).toBeUndefined();
  });
});

describe("an incident that kept no metric snapshot: its monitor's metrics as it reads them now", () => {
  test("a Metrics monitor's step, with its formulas, for the services it is held to, and the note", () => {
    const metrics: RootCauseMetrics | null = getRootCauseMetrics({
      telemetryQuery: null,
      seriesLabels: null,
      monitors: [
        monitorOf(MonitorType.Metrics, [
          {
            settings: { telemetryServiceIds: ["service-1"] },
            queryConfigs: [queryOf({ metricName: "http.errors" })],
            formulaConfigs: [FORMULA],
          },
        ]),
      ],
    });

    expect(metrics).not.toBeNull();
    expect(metrics!.telemetryQuery).toEqual({
      telemetryType: TelemetryType.Metric,
      telemetryQuery: null,
      metricViewData: {
        startAndEndDate: null,
        queryConfigs: [
          expect.objectContaining({
            metricQueryData: expect.objectContaining({
              filterData: expect.objectContaining({
                metricName: "http.errors",
                telemetryServiceIds: ["service-1"],
              }),
            }),
          }),
        ],
        formulaConfigs: [FORMULA],
      },
    });
    // Nothing the monitor evaluated to shade, and the card says so.
    expect(metrics!.evaluationWindow).toBeNull();
    expect(metrics!.chartedFromMonitorNow).toEqual({ resourceName: "" });
  });

  test("an infrastructure monitor's step, read for the host it watches, named in the note", () => {
    const metrics: RootCauseMetrics | null = getRootCauseMetrics({
      telemetryQuery: null,
      seriesLabels: null,
      monitors: [
        monitorOf(MonitorType.Host, [
          {
            settings: { hostIdentifier: "web-01" },
            queryConfigs: [queryOf({ metricName: "system.cpu.utilization" })],
          },
        ]),
      ],
    });

    expect(attributesOf(metrics)).toEqual({ "resource.host.name": "web-01" });
    expect(metrics!.chartedFromMonitorNow).toEqual({ resourceName: "web-01" });
  });

  test("narrowed to the incident's own series, and says so", () => {
    const metrics: RootCauseMetrics | null = getRootCauseMetrics({
      telemetryQuery: null,
      seriesLabels: SERIES,
      monitors: [
        monitorOf(MonitorType.Metrics, [
          { queryConfigs: [queryOf({ groupBy: ["resource.host.name"] })] },
        ]),
      ],
    });

    expect(attributesOf(metrics)).toEqual({ "resource.host.name": "prod-01" });
    expect(metrics!.seriesSummary).toBe("resource.host.name = prod-01");
  });

  test("a snapshot of logs, traces or exceptions is no metric snapshot: the metric monitor is charted", () => {
    for (const telemetryType of [
      TelemetryType.Log,
      TelemetryType.Trace,
      TelemetryType.Exception,
    ]) {
      const metrics: RootCauseMetrics | null = getRootCauseMetrics({
        telemetryQuery: {
          telemetryType: telemetryType,
          telemetryQuery: { time: EVALUATED } as never,
          metricViewData: null,
        },
        seriesLabels: null,
        monitors: [
          monitorOf(MonitorType.Metrics, [{ queryConfigs: [queryOf({})] }]),
        ],
      });

      expect(metricNamesOf(metrics)).toEqual(["cpu"]);
      expect(metrics!.chartedFromMonitorNow).toEqual({ resourceName: "" });
    }
  });

  test("a metric snapshot with no metric in it is none either", () => {
    const metrics: RootCauseMetrics | null = getRootCauseMetrics({
      telemetryQuery: metricSnapshot([]),
      seriesLabels: null,
      monitors: [
        monitorOf(MonitorType.Metrics, [
          { queryConfigs: [queryOf({ metricName: "memory" })] },
        ]),
      ],
    });

    expect(metricNamesOf(metrics)).toEqual(["memory"]);
  });

  test("the step holding the incident's criteria is charted, whichever step it is", () => {
    const metrics: RootCauseMetrics | null = getRootCauseMetrics({
      telemetryQuery: null,
      seriesLabels: null,
      createdCriteriaId: RULE_ID,
      monitors: [
        monitorOf(MonitorType.Metrics, [
          { queryConfigs: [queryOf({ metricName: "first" })] },
          {
            queryConfigs: [queryOf({ metricName: "breached" })],
            criteriaIds: ["other-rule", RULE_ID],
          },
        ]),
      ],
    });

    expect(metricNamesOf(metrics)).toEqual(["breached"]);
  });

  test("in whichever of the incident's monitors holds it", () => {
    const metrics: RootCauseMetrics | null = getRootCauseMetrics({
      telemetryQuery: null,
      seriesLabels: null,
      createdCriteriaId: RULE_ID,
      monitors: [
        monitorOf(MonitorType.Metrics, [
          { queryConfigs: [queryOf({ metricName: "first-monitor" })] },
        ]),
        monitorOf(MonitorType.Host, [
          {
            settings: { hostIdentifier: "db-01" },
            queryConfigs: [queryOf({ metricName: "second-monitor" })],
            criteriaIds: [RULE_ID],
          },
        ]),
      ],
    });

    expect(metricNamesOf(metrics)).toEqual(["second-monitor"]);
    expect(metrics!.chartedFromMonitorNow).toEqual({ resourceName: "db-01" });
  });

  test("with no criteria, or one no step holds, the first step with a metric of the first monitor that has one", () => {
    for (const createdCriteriaId of [undefined, null, "", "  ", "gone"]) {
      const metrics: RootCauseMetrics | null = getRootCauseMetrics({
        telemetryQuery: null,
        seriesLabels: null,
        createdCriteriaId: createdCriteriaId,
        monitors: [
          // An API monitor reads no metrics.
          monitorOf(MonitorType.API, [{ queryConfigs: [queryOf({})] }]),
          monitorOf(MonitorType.Metrics, [
            // Still being set up: no metric picked yet.
            { queryConfigs: [queryOf({ metricName: "" })] },
            { queryConfigs: [queryOf({ metricName: "second-step" })] },
          ]),
          monitorOf(MonitorType.Metrics, [
            { queryConfigs: [queryOf({ metricName: "later-monitor" })] },
          ]),
        ],
      });

      expect({ createdCriteriaId, names: metricNamesOf(metrics) }).toEqual({
        createdCriteriaId,
        names: ["second-step"],
      });
    }
  });
});

describe("an incident with no metrics behind it", () => {
  test.each([
    ["no snapshot and no monitors", null, []],
    ["no snapshot and no monitor list at all", null, null],
    [
      "a logs snapshot and only an API monitor",
      {
        telemetryType: TelemetryType.Log,
        telemetryQuery: null,
        metricViewData: null,
      } as TelemetryQuery,
      [monitorOf(MonitorType.API, [{ queryConfigs: [queryOf({})] }])],
    ],
    [
      "a metric monitor with no metric picked yet",
      null,
      [
        monitorOf(MonitorType.Metrics, [
          { queryConfigs: [queryOf({ metricName: "" })] },
        ]),
      ],
    ],
    [
      "a metric monitor with no steps",
      null,
      [monitorOf(MonitorType.Metrics, [])],
    ],
  ])(
    "%s: no card",
    (
      _name: string,
      telemetryQuery: TelemetryQuery | null,
      monitors: Array<RootCauseMonitor> | null,
    ) => {
      expect(
        getRootCauseMetrics({
          telemetryQuery: telemetryQuery,
          seriesLabels: SERIES,
          createdCriteriaId: RULE_ID,
          monitors: monitors,
        }),
      ).toBeNull();
    },
  );

  test("a monitor with no steps stored, or not an object at all, is passed over", () => {
    expect(
      getRootCauseMetrics({
        telemetryQuery: null,
        seriesLabels: null,
        monitors: [
          { monitorType: MonitorType.Metrics, monitorSteps: null },
          { monitorType: MonitorType.Metrics },
          null as unknown as RootCauseMonitor,
          monitorOf(MonitorType.Metrics, [
            { queryConfigs: [queryOf({ metricName: "found" })] },
          ]),
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        chartedFromMonitorNow: { resourceName: "" },
      }),
    );
  });
});

describe("seeded: whatever an incident holds", () => {
  test("the card charts metrics or there is none: never a query without a metric, never a throw", () => {
    const random: SeededRandom = seededRandom(6249);
    const types: Array<MonitorType> = [
      MonitorType.Metrics,
      MonitorType.Host,
      MonitorType.Kubernetes,
      MonitorType.API,
      MonitorType.Logs,
    ];

    for (let draw: number = 0; draw < 300; draw++) {
      const monitors: Array<RootCauseMonitor> = [];
      const monitorCount: number = random(4);

      for (let index: number = 0; index < monitorCount; index++) {
        const steps: Array<StepData> = [];
        const stepCount: number = random(3);

        for (let step: number = 0; step < stepCount; step++) {
          steps.push({
            settings: { hostIdentifier: random(2) ? "host-a" : "" },
            queryConfigs: random(3)
              ? [queryOf({ metricName: random(4) ? `m-${draw}` : "" })]
              : [],
            criteriaIds: random(3) ? [] : [RULE_ID],
          });
        }

        monitors.push(monitorOf(types[random(types.length)]!, steps));
      }

      const hasSnapshot: boolean = random(3) === 0;

      const metrics: RootCauseMetrics | null = getRootCauseMetrics({
        telemetryQuery: hasSnapshot
          ? metricSnapshot(random(2) ? [queryOf({})] : [])
          : null,
        seriesLabels: random(2) ? SERIES : null,
        createdCriteriaId: random(2) ? RULE_ID : undefined,
        monitors: monitors,
      });

      if (metrics) {
        const names: Array<string> = metricNamesOf(metrics);
        expect(names.length).toBeGreaterThan(0);
        expect(
          names.some((name: string): boolean => {
            return name.length > 0;
          }),
        ).toBe(true);
        expect(metrics.telemetryQuery.telemetryType).toBe(TelemetryType.Metric);
        // Charted from the monitor now exactly when no snapshot was used.
        expect(Boolean(metrics.chartedFromMonitorNow)).toBe(
          metrics.evaluationWindow === null,
        );
      }
    }
  });
});
