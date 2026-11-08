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
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";
import { StateListType } from "Common/Utils/StateOrder";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  AlertRootCauseRow,
  IncidentRootCauseRow,
  RootCauseEvent,
  RootCauseMetrics,
  RootCauseMonitor,
  RootCauseState,
  RootCauseTimes,
  getAlertRootCauseEvent,
  getIncidentRootCauseEvent,
  getRootCauseMetrics,
  getRootCauseTimes,
} from "../../FeatureSet/Dashboard/src/Utils/EventRootCauseMetrics";
import { EventStateTimelineDate } from "../../FeatureSet/Dashboard/src/Utils/EventDuration";

/*
 * What an incident's or an alert's Root Cause page charts (issues #6249 and
 * #6304): the metric investigation its Overview shows, beside the root
 * cause. What the event kept of the check that opened it when it kept a
 * metric snapshot - exactly what the Overview charts - and otherwise its
 * monitor's metrics as the monitor reads them now (an incident declared or
 * an alert created by hand on a metric monitor, or one opened before events
 * kept a snapshot), which the card says. Nothing for an event with no
 * metrics behind it.
 *
 * An incident is on a list of monitors and an alert on one: each row is
 * read into the same event (getIncidentRootCauseEvent,
 * getAlertRootCauseEvent), which is charted and anchored by one rule, so
 * the two Root Cause pages chart the same thing for the same data.
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

/*
 * ISSUE #6304: AN ALERT'S ROOT CAUSE PAGE CHARTS ITS METRICS AS AN
 * INCIDENT'S DOES.
 *
 * An alert is read into the same event as an incident: created where an
 * incident is declared, and on its one monitor where an incident is on a
 * list. From there the same rule charts it and anchors its ranges.
 */

const CREATED_AT: Date = new Date("2026-11-05T05:44:00.000Z");
const IMPACT_STARTED_AT: Date = new Date("2026-11-05T05:20:00.000Z");

// The metric snapshot as the row stores it and the API hands it back: JSON.
function storedMetricSnapshot(
  queryConfigs: Array<MetricQueryConfigData>,
): JSONObject {
  return {
    telemetryType: TelemetryType.Metric,
    telemetryQuery: null,
    metricViewData: {
      // Through the serializer the worker stores it with: its bounds flat.
      startAndEndDate: JSONFunctions.anyObjectToJSONObject(EVALUATED),
      queryConfigs: queryConfigs as unknown as Array<JSONObject>,
      formulaConfigs: [FORMULA as unknown as JSONObject],
    },
  };
}

const STORED_LOGS_SNAPSHOT: JSONObject = {
  telemetryType: TelemetryType.Log,
  telemetryQuery: {},
  metricViewData: null,
};

describe("an incident's row, read for its Root Cause card", () => {
  test("declared, on every monitor it lists, its stored snapshot read back with its window as Dates", () => {
    const first: RootCauseMonitor = monitorOf(MonitorType.Metrics, [
      { queryConfigs: [queryOf({})] },
    ]);
    const second: RootCauseMonitor = monitorOf(MonitorType.Host, [
      { queryConfigs: [queryOf({})] },
    ]);

    const event: RootCauseEvent = getIncidentRootCauseEvent({
      declaredAt: CREATED_AT,
      impactStartedAt: IMPACT_STARTED_AT,
      telemetryQuery: storedMetricSnapshot([queryOf({})]),
      seriesLabels: SERIES,
      createdCriteriaId: RULE_ID,
      monitors: [first, second],
    });

    expect(event.startedAt).toBe(CREATED_AT);
    expect(event.impactStartedAt).toBe(IMPACT_STARTED_AT);
    expect(event.seriesLabels).toEqual(SERIES);
    expect(event.createdCriteriaId).toBe(RULE_ID);
    expect(event.monitors).toEqual([first, second]);
    expect(event.monitors[0]).toBe(first);

    const window: InBetween<Date> | null | undefined =
      event.telemetryQuery?.metricViewData?.startAndEndDate;
    expect(window?.startValue).toBeInstanceOf(Date);
    expect(window?.startValue.toISOString()).toBe("2026-11-05T05:39:00.000Z");
    expect(window?.endValue.toISOString()).toBe("2026-11-05T05:44:00.000Z");
    expect(event.telemetryQuery?.metricViewData?.formulaConfigs).toEqual([
      FORMULA,
    ]);
  });

  test("what the row does not hold reads as nothing", () => {
    expect(getIncidentRootCauseEvent({})).toEqual({
      startedAt: undefined,
      impactStartedAt: undefined,
      telemetryQuery: null,
      seriesLabels: null,
      createdCriteriaId: null,
      monitors: [],
    });
  });

  test("a value of the wrong kind is no value: never an Invalid Date, a snapshot or labels that are not objects", () => {
    const event: RootCauseEvent = getIncidentRootCauseEvent({
      declaredAt: new Date(Number.NaN),
      impactStartedAt: "2026-11-05T05:20:00.000Z" as unknown as Date,
      telemetryQuery: "not a snapshot",
      seriesLabels: ["resource.host.name"],
      createdCriteriaId: 7 as unknown as string,
      monitors: [null, undefined, "monitor" as unknown as RootCauseMonitor],
    });

    expect(event).toEqual({
      startedAt: undefined,
      impactStartedAt: undefined,
      telemetryQuery: null,
      seriesLabels: null,
      createdCriteriaId: null,
      monitors: [],
    });

    for (const telemetryQuery of [[], 0, true, null, undefined]) {
      expect(
        getIncidentRootCauseEvent({ telemetryQuery: telemetryQuery })
          .telemetryQuery,
      ).toBeNull();
    }
  });
});

describe("an alert's row, read for its Root Cause card", () => {
  test("created, and on its one monitor: a list of one", () => {
    const monitor: RootCauseMonitor = monitorOf(MonitorType.Metrics, [
      { queryConfigs: [queryOf({})] },
    ]);

    const event: RootCauseEvent = getAlertRootCauseEvent({
      createdAt: CREATED_AT,
      impactStartedAt: IMPACT_STARTED_AT,
      telemetryQuery: storedMetricSnapshot([queryOf({})]),
      seriesLabels: SERIES,
      createdCriteriaId: RULE_ID,
      monitor: monitor,
    });

    expect(event.startedAt).toBe(CREATED_AT);
    expect(event.impactStartedAt).toBe(IMPACT_STARTED_AT);
    expect(event.monitors).toHaveLength(1);
    expect(event.monitors[0]).toBe(monitor);
    expect(event.createdCriteriaId).toBe(RULE_ID);
    expect(event.seriesLabels).toEqual(SERIES);
    expect(
      event.telemetryQuery?.metricViewData?.startAndEndDate?.endValue,
    ).toEqual(EVALUATED.endValue);
  });

  test.each([
    ["raised by hand, with no monitor", null],
    [
      "whose monitor was deleted since (the row's monitor reads back empty)",
      undefined,
    ],
  ])(
    "an alert %s is on no monitor",
    (_name: string, monitor: null | undefined) => {
      expect(
        getAlertRootCauseEvent({ createdAt: CREATED_AT, monitor: monitor })
          .monitors,
      ).toEqual([]);
    },
  );

  test("an alert reads as the incident it would be: created where an incident is declared, its monitor a list of one", () => {
    const monitor: RootCauseMonitor = monitorOf(MonitorType.Host, [
      {
        settings: { hostIdentifier: "web-01" },
        queryConfigs: [queryOf({})],
      },
    ]);
    const row: Omit<AlertRootCauseRow, "createdAt" | "monitor"> = {
      impactStartedAt: IMPACT_STARTED_AT,
      telemetryQuery: STORED_LOGS_SNAPSHOT,
      seriesLabels: SERIES,
      createdCriteriaId: RULE_ID,
    };

    expect(
      getAlertRootCauseEvent({
        ...row,
        createdAt: CREATED_AT,
        monitor: monitor,
      }),
    ).toEqual(
      getIncidentRootCauseEvent({
        ...row,
        declaredAt: CREATED_AT,
        monitors: [monitor],
      } as IncidentRootCauseRow),
    );
  });
});

function chartAlert(row: AlertRootCauseRow): RootCauseMetrics | null {
  return getRootCauseMetrics(getAlertRootCauseEvent(row));
}

describe("an alert that kept a metric snapshot: what its Overview charts", () => {
  test("the snapshot, narrowed to the alert's series as its Overview narrows it, with what the monitor evaluated, and no note", () => {
    const stored: JSONObject = storedMetricSnapshot([
      queryOf({ groupBy: ["resource.host.name"] }),
    ]);

    const metrics: RootCauseMetrics | null = chartAlert({
      createdAt: CREATED_AT,
      telemetryQuery: stored,
      seriesLabels: SERIES,
      monitor: monitorOf(MonitorType.Metrics, [
        { queryConfigs: [queryOf({ metricName: "memory" })] },
      ]),
    });

    /*
     * What the alert's Overview works out of the same row
     * (Pages/Alerts/View/Index.tsx): the stored JSON read back and
     * hydrated, narrowed to the series, summarised as it was narrowed.
     */
    const overview: TelemetryQuery = TelemetryQueryTimeRange.hydrate(
      JSONFunctions.deserialize(stored) as unknown as TelemetryQuery,
    )!;

    expect(metrics).not.toBeNull();
    expect(metrics!.telemetryQuery.metricViewData).toEqual(
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData: overview.metricViewData!,
        seriesLabels: SERIES,
      }),
    );
    expect(attributesOf(metrics)).toEqual({ "resource.host.name": "prod-01" });
    expect(metrics!.evaluationWindow).toEqual(
      TelemetryQueryTimeRange.getSnapshotWindow(overview),
    );
    expect(metrics!.evaluationWindow?.startValue.toISOString()).toBe(
      "2026-11-05T05:39:00.000Z",
    );
    expect(metrics!.seriesSummary).toBe("resource.host.name = prod-01");
    // The snapshot wins over the monitor as it reads now, which charts memory.
    expect(metricNamesOf(metrics)).toEqual(["cpu"]);
    expect(metrics!.chartedFromMonitorNow).toBeUndefined();
  });

  test("an alert on no monitor charts its snapshot all the same", () => {
    const metrics: RootCauseMetrics | null = chartAlert({
      createdAt: CREATED_AT,
      telemetryQuery: storedMetricSnapshot([queryOf({})]),
      monitor: null,
    });

    expect(metricNamesOf(metrics)).toEqual(["cpu"]);
    expect(metrics!.chartedFromMonitorNow).toBeUndefined();
  });
});

describe("an alert that kept no metric snapshot: its monitor's metrics as it reads them now", () => {
  test("a Metrics monitor's step, with its formulas, and the note", () => {
    const metrics: RootCauseMetrics | null = chartAlert({
      createdAt: CREATED_AT,
      telemetryQuery: null,
      monitor: monitorOf(MonitorType.Metrics, [
        {
          settings: { telemetryServiceIds: ["service-1"] },
          queryConfigs: [queryOf({ metricName: "http.errors" })],
          formulaConfigs: [FORMULA],
        },
      ]),
    });

    expect(metricNamesOf(metrics)).toEqual(["http.errors"]);
    expect(
      metrics!.telemetryQuery.metricViewData?.queryConfigs[0]?.metricQueryData
        .filterData,
    ).toEqual(expect.objectContaining({ telemetryServiceIds: ["service-1"] }));
    expect(metrics!.telemetryQuery.metricViewData?.formulaConfigs).toEqual([
      FORMULA,
    ]);
    // Nothing the monitor evaluated to shade, and the card says so.
    expect(metrics!.evaluationWindow).toBeNull();
    expect(metrics!.chartedFromMonitorNow).toEqual({ resourceName: "" });
  });

  test("an infrastructure monitor's step, read for the host it watches, named in the note", () => {
    const metrics: RootCauseMetrics | null = chartAlert({
      createdAt: CREATED_AT,
      monitor: monitorOf(MonitorType.Host, [
        {
          settings: { hostIdentifier: "web-01" },
          queryConfigs: [queryOf({ metricName: "system.cpu.utilization" })],
        },
      ]),
    });

    expect(attributesOf(metrics)).toEqual({ "resource.host.name": "web-01" });
    expect(metrics!.chartedFromMonitorNow).toEqual({ resourceName: "web-01" });
  });

  test("the step holding the alert's criteria is charted, narrowed to the alert's series", () => {
    const metrics: RootCauseMetrics | null = chartAlert({
      createdAt: CREATED_AT,
      createdCriteriaId: RULE_ID,
      seriesLabels: SERIES,
      monitor: monitorOf(MonitorType.Metrics, [
        { queryConfigs: [queryOf({ metricName: "first" })] },
        {
          queryConfigs: [
            queryOf({
              metricName: "breached",
              groupBy: ["resource.host.name"],
            }),
          ],
          criteriaIds: [RULE_ID],
        },
      ]),
    });

    expect(metricNamesOf(metrics)).toEqual(["breached"]);
    expect(attributesOf(metrics)).toEqual({ "resource.host.name": "prod-01" });
    expect(metrics!.seriesSummary).toBe("resource.host.name = prod-01");
  });

  test("a logs snapshot is no metric snapshot: the alert's metric monitor is charted", () => {
    const metrics: RootCauseMetrics | null = chartAlert({
      createdAt: CREATED_AT,
      telemetryQuery: STORED_LOGS_SNAPSHOT,
      monitor: monitorOf(MonitorType.Metrics, [
        { queryConfigs: [queryOf({ metricName: "http.server.errors" })] },
      ]),
    });

    expect(metricNamesOf(metrics)).toEqual(["http.server.errors"]);
    expect(metrics!.chartedFromMonitorNow).toEqual({ resourceName: "" });
  });
});

describe("an alert with no metrics behind it: no card", () => {
  test.each([
    ["no snapshot and no monitor", { telemetryQuery: null, monitor: null }],
    [
      "no snapshot and a monitor that reads no metrics (an API monitor)",
      {
        telemetryQuery: null,
        monitor: monitorOf(MonitorType.API, [{ queryConfigs: [queryOf({})] }]),
      },
    ],
    [
      "a logs snapshot and no monitor",
      { telemetryQuery: STORED_LOGS_SNAPSHOT, monitor: undefined },
    ],
    [
      "a logs snapshot and a logs monitor",
      {
        telemetryQuery: STORED_LOGS_SNAPSHOT,
        monitor: monitorOf(MonitorType.Logs, [{ queryConfigs: [queryOf({})] }]),
      },
    ],
    [
      "a metric snapshot with no metric in it, and no monitor",
      { telemetryQuery: storedMetricSnapshot([]), monitor: null },
    ],
    [
      "a metric monitor with no metric picked yet",
      {
        telemetryQuery: null,
        monitor: monitorOf(MonitorType.Metrics, [
          { queryConfigs: [queryOf({ metricName: "" })] },
        ]),
      },
    ],
    [
      "a metric monitor with no steps",
      { telemetryQuery: null, monitor: monitorOf(MonitorType.Metrics, []) },
    ],
    [
      "a metric monitor whose steps did not come back",
      {
        telemetryQuery: null,
        monitor: { monitorType: MonitorType.Metrics, monitorSteps: null },
      },
    ],
  ])("%s", (_name: string, row: Partial<AlertRootCauseRow>) => {
    expect(
      chartAlert({
        createdAt: CREATED_AT,
        seriesLabels: SERIES,
        createdCriteriaId: RULE_ID,
        ...row,
      }),
    ).toBeNull();
  });
});

/*
 * When the card's ranges start and end, as the event's Overview works them
 * out: the states of the project's list that count as resolved are its
 * resolved state and every state placed after it.
 */
const STATES: Array<RootCauseState> = [
  { _id: "created", name: "Created", order: 1 },
  {
    _id: "acknowledged",
    name: "Acknowledged",
    isAcknowledgedState: true,
    order: 2,
  },
  { _id: "resolved", name: "Resolved", isResolvedState: true, order: 3 },
  // A state of the project's own, placed after Resolved: resolved too.
  { _id: "closed", name: "Closed", order: 4 },
];

const MINUTE_MS: number = 60 * 1000;

function minutesAfterCreated(minutes: number): Date {
  return new Date(CREATED_AT.getTime() + minutes * MINUTE_MS);
}

function timelineOf(
  entries: Array<[string, number]>,
): Array<EventStateTimelineDate> {
  return entries.map(
    ([stateId, minutes]: [string, number]): EventStateTimelineDate => {
      return { stateId: stateId, startsAt: minutesAfterCreated(minutes) };
    },
  );
}

function timesOf(
  startedAt: Date | undefined,
  timeline: Array<EventStateTimelineDate>,
  states: Array<RootCauseState> = STATES,
): RootCauseTimes {
  const alertTimes: RootCauseTimes = getRootCauseTimes({
    startedAt: startedAt,
    stateTimeline: timeline,
    states: states,
    stateList: StateListType.AlertState,
  });

  // An incident's list reads by the same rule.
  expect(
    getRootCauseTimes({
      startedAt: startedAt,
      stateTimeline: timeline,
      states: states,
      stateList: StateListType.IncidentState,
    }),
  ).toEqual(alertTimes);

  return alertTimes;
}

describe("when the card's ranges start and end", () => {
  test("an open alert: started when it was created, and no end, so the ranges run to now", () => {
    expect(
      timesOf(
        CREATED_AT,
        timelineOf([
          ["created", 0],
          ["acknowledged", 10],
        ]),
      ),
    ).toEqual({ startedAt: CREATED_AT, endedAt: undefined });
  });

  test("a resolved alert: ends when it moved into the resolved state", () => {
    expect(
      timesOf(
        CREATED_AT,
        timelineOf([
          ["created", 0],
          ["acknowledged", 10],
          ["resolved", 40],
        ]),
      ),
    ).toEqual({ startedAt: CREATED_AT, endedAt: minutesAfterCreated(40) });
  });

  test("moving on from Resolved to a state placed after it does not move the end", () => {
    expect(
      timesOf(
        CREATED_AT,
        timelineOf([
          ["created", 0],
          ["resolved", 40],
          ["closed", 90],
        ]),
      ).endedAt,
    ).toEqual(minutesAfterCreated(40));
  });

  test("reopened after it was resolved: open again", () => {
    expect(
      timesOf(
        CREATED_AT,
        timelineOf([
          ["created", 0],
          ["resolved", 40],
          ["acknowledged", 60],
        ]),
      ).endedAt,
    ).toBeUndefined();
  });

  test("resolved again after a reopen: ends at the latest resolve", () => {
    expect(
      timesOf(
        CREATED_AT,
        timelineOf([
          ["created", 0],
          ["resolved", 40],
          ["acknowledged", 60],
          ["resolved", 75],
        ]),
      ).endedAt,
    ).toEqual(minutesAfterCreated(75));
  });

  test("the timeline is read by time, whatever order it came back in", () => {
    expect(
      timesOf(
        CREATED_AT,
        timelineOf([
          ["resolved", 40],
          ["created", 0],
          ["acknowledged", 10],
        ]),
      ).endedAt,
    ).toEqual(minutesAfterCreated(40));
  });

  test("a row with no start: its first state's start stands in, as on its Overview", () => {
    expect(
      timesOf(
        undefined,
        timelineOf([
          ["acknowledged", 10],
          ["created", -5],
        ]),
      ).startedAt,
    ).toEqual(minutesAfterCreated(-5));
    expect(timesOf(undefined, [])).toEqual({
      startedAt: undefined,
      endedAt: undefined,
    });
  });

  test("without the project's states nothing counts as resolved: no end", () => {
    expect(
      timesOf(CREATED_AT, timelineOf([["resolved", 40]]), []).endedAt,
    ).toBeUndefined();
  });

  test("a state id the timeline holds as an id reads as the state's own", () => {
    expect(
      timesOf(CREATED_AT, [
        {
          stateId: new ObjectID("resolved").toString(),
          startsAt: minutesAfterCreated(30),
        },
      ]).endedAt,
    ).toEqual(minutesAfterCreated(30));
  });
});

/*
 * SEEDED: AN ALERT AND AN INCIDENT WITH THE SAME DATA READ ALIKE.
 *
 * Whatever the row holds - a metric snapshot with or without a metric, a
 * logs one, none, a value of the wrong kind; a monitor of any kind with
 * any steps, or none; any series, criteria, start and state timeline - the
 * alert's path and the incident's give the same event, the same metrics
 * and the same moments, and the alert's card is there exactly when the
 * snapshot or the monitor has a metric to chart.
 */
// A timeline entry and its place in the list it came back in.
interface PlacedEntry {
  entry: EventStateTimelineDate;
  index: number;
}

describe("seeded: an alert and an incident with the same data", () => {
  const METRIC_TYPES: Array<MonitorType> = [
    MonitorType.Metrics,
    MonitorType.Host,
    MonitorType.Kubernetes,
  ];
  const OTHER_TYPES: Array<MonitorType> = [MonitorType.API, MonitorType.Logs];
  const STATE_IDS: Array<string> = [
    "created",
    "acknowledged",
    "resolved",
    "closed",
  ];
  const RESOLVED_IDS: Array<string> = ["resolved", "closed"];

  function pick<T>(random: SeededRandom, values: Array<T>): T {
    return values[random(values.length)]!;
  }

  test("read alike, chart alike and anchor alike, and an alert's card is there exactly when there is a metric to chart", () => {
    const random: SeededRandom = seededRandom(6304);
    let cards: number = 0;
    let fromMonitorNow: number = 0;
    let resolved: number = 0;

    for (let draw: number = 0; draw < 500; draw++) {
      // The alert's one monitor, or none; the incident is on it alone.
      let monitor: RootCauseMonitor | null = null;
      let monitorHasMetric: boolean = false;

      if (random(4) !== 0) {
        const isMetricType: boolean = random(3) !== 0;
        const steps: Array<StepData> = [];
        const stepCount: number = random(3);

        for (let step: number = 0; step < stepCount; step++) {
          const metricName: string = random(4) ? `m-${draw}-${step}` : "";
          const hasQuery: boolean = random(4) !== 0;

          steps.push({
            settings: { hostIdentifier: random(2) ? "host-a" : "" },
            queryConfigs: hasQuery ? [queryOf({ metricName: metricName })] : [],
            criteriaIds: random(3) ? [] : [RULE_ID],
          });

          monitorHasMetric =
            monitorHasMetric || (isMetricType && hasQuery && metricName !== "");
        }

        monitor = monitorOf(
          pick(random, isMetricType ? METRIC_TYPES : OTHER_TYPES),
          steps,
        );
      }

      const snapshotKind: number = random(5);
      const snapshotHasMetric: boolean = snapshotKind === 0;
      const telemetryQuery: unknown = [
        storedMetricSnapshot([queryOf({ groupBy: ["resource.host.name"] })]),
        storedMetricSnapshot([]),
        STORED_LOGS_SNAPSHOT,
        null,
        "not a snapshot",
      ][snapshotKind];

      const startedAt: Date | null | undefined = pick(random, [
        CREATED_AT,
        CREATED_AT,
        undefined,
        null,
        new Date(Number.NaN),
      ]);

      const timeline: Array<EventStateTimelineDate> = [];
      const entryCount: number = random(5);

      for (let entry: number = 0; entry < entryCount; entry++) {
        timeline.push({
          stateId: pick(random, [...STATE_IDS, "deleted-state"]),
          startsAt: minutesAfterCreated(random(240) - 30),
        });
      }

      const common: Omit<AlertRootCauseRow, "createdAt" | "monitor"> = {
        impactStartedAt: random(2) ? IMPACT_STARTED_AT : undefined,
        telemetryQuery: telemetryQuery,
        seriesLabels: pick(random, [SERIES, null, undefined, ["x"], "x"]),
        createdCriteriaId: pick(random, [RULE_ID, undefined, null, "", "gone"]),
      };

      const alert: RootCauseEvent = getAlertRootCauseEvent({
        ...common,
        createdAt: startedAt,
        monitor: monitor || pick(random, [null, undefined]),
      });
      const incident: RootCauseEvent = getIncidentRootCauseEvent({
        ...common,
        declaredAt: startedAt,
        monitors: monitor ? [monitor] : pick(random, [[], null, undefined]),
      } as IncidentRootCauseRow);

      // The same event, the same metrics, the same moments.
      expect(alert).toEqual(incident);

      const metrics: RootCauseMetrics | null = getRootCauseMetrics(alert);
      expect(metrics).toEqual(getRootCauseMetrics(incident));

      const times: RootCauseTimes = timesOf(alert.startedAt, timeline);

      // A card exactly when the snapshot or the monitor has a metric to chart.
      expect({ draw, card: metrics !== null }).toEqual({
        draw,
        card: snapshotHasMetric || monitorHasMetric,
      });

      if (metrics) {
        cards++;
        expect(metrics.telemetryQuery.telemetryType).toBe(TelemetryType.Metric);
        expect(
          metricNamesOf(metrics).some((name: string): boolean => {
            return name.length > 0;
          }),
        ).toBe(true);
        // From the monitor now exactly when there was no snapshot to chart.
        expect(Boolean(metrics.chartedFromMonitorNow)).toBe(!snapshotHasMetric);
        expect(metrics.evaluationWindow === null).toBe(!snapshotHasMetric);
        fromMonitorNow += metrics.chartedFromMonitorNow ? 1 : 0;
      }

      // It started when it was created, or else with its first state.
      const firstStateMs: number = Math.min(
        ...timeline.map((entry: EventStateTimelineDate): number => {
          return entry.startsAt!.getTime();
        }),
      );
      const expectedStartMs: number | undefined =
        startedAt instanceof Date && Number.isFinite(startedAt.getTime())
          ? startedAt.getTime()
          : timeline.length > 0
            ? firstStateMs
            : undefined;
      expect(times.startedAt?.getTime()).toBe(expectedStartMs);

      // It ended only while its latest state counts as resolved.
      const latest: EventStateTimelineDate | undefined = timeline
        .map((entry: EventStateTimelineDate, index: number): PlacedEntry => {
          return { entry, index };
        })
        .sort((first: PlacedEntry, second: PlacedEntry): number => {
          // By time; a later entry in the list wins a tie, as the rule reads it.
          return (
            first.entry.startsAt!.getTime() -
              second.entry.startsAt!.getTime() || first.index - second.index
          );
        })
        .map((placed: PlacedEntry): EventStateTimelineDate => {
          return placed.entry;
        })
        .pop();
      const isResolvedNow: boolean = Boolean(
        latest && RESOLVED_IDS.includes(latest.stateId || ""),
      );
      expect(times.endedAt !== undefined).toBe(isResolvedNow);

      if (times.endedAt) {
        resolved++;
        expect(times.endedAt.getTime()).toBeLessThanOrEqual(
          latest!.startsAt!.getTime(),
        );
      }
    }

    // The draws reach every case, not one of them over and over.
    expect(cards).toBeGreaterThan(100);
    expect(fromMonitorNow).toBeGreaterThan(30);
    expect(cards - fromMonitorNow).toBeGreaterThan(30);
    expect(resolved).toBeGreaterThan(30);
  });
});
