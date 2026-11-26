import { describe, expect, it } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import OneUptimeDate from "../../../Types/Date";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import TelemetryObservation, {
  TelemetryObservationKind,
} from "../../../Types/Monitor/TelemetryObservation";
import MonitorRecordEvidence from "../../../Server/Utils/Monitor/MonitorRecordEvidence";
import MonitorLogSummaryUtil from "../../../Utils/Monitor/MonitorLogSummaryUtil";
import { MonitorSummaryInfoProps } from "../../../Utils/Monitor/MonitorSummarySnapshotUtil";

/*
 * MONITORING LOGS ON EVERY MONITOR BUT A MANUAL ONE (issue #6639).
 *
 * The telemetry worker's checks of a Metrics, Logs, Kubernetes or any other
 * telemetry monitor were always written to MonitorLog (MonitorResource ends
 * every evaluation with MonitorLogUtil.saveMonitorLog), but the Dashboard
 * hid the page. Now the page is there, and each row says what its check
 * saw: the logs, spans or exceptions the criteria counted, or how much data
 * a metric check read - "No data" said, not left as a 0.
 *
 * Every body here is stored the way MonitorLogUtil writes it: a JSON round
 * trip, cut by MonitorRecordEvidence.redactCheck - ids are ObjectID
 * envelopes and dates ISO strings.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITORED_AT: Date = OneUptimeDate.fromString("2026-11-10T09:12:00.000Z");

const EVALUATION_SUMMARY: MonitorEvaluationSummary = {
  evaluatedAt: MONITORED_AT,
  criteriaResults: [
    {
      criteriaId: "criteria-1",
      criteriaName: "High CPU",
      filterCondition: FilterCondition.Any,
      met: true,
      message: "Metric value recorded latest 92.00% (expected above 80%).",
      filters: [],
    },
  ],
  events: [],
};

function storeAsMonitorLog(dataToProcess: unknown): JSONObject {
  return MonitorRecordEvidence.redactCheck({
    check: JSON.parse(JSON.stringify(dataToProcess)),
    keepResponseContent: true,
  });
}

function base(): JSONObject {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    evaluationSummary: EVALUATION_SUMMARY,
  } as unknown as JSONObject;
}

// A metric query's result: `points` data points of a series.
function aggregated(
  points: number,
  attributes?: JSONObject,
): { data: Array<JSONObject> } {
  const data: Array<JSONObject> = [];

  for (let index: number = 0; index < points; index++) {
    data.push({
      timestamp: OneUptimeDate.addRemoveMinutes(MONITORED_AT, -index),
      value: 40 + index,
      ...(attributes || {}),
    } as unknown as JSONObject);
  }

  return { data };
}

function metricCheck(data: {
  results: Array<{ data: Array<JSONObject> }>;
  series?: Array<{
    fingerprint: string;
    labels: JSONObject;
    aggregatedResults: Array<{ data: Array<JSONObject> }>;
  }>;
}): JSONObject {
  return {
    ...base(),
    startAndEndDate: {
      startValue: OneUptimeDate.addRemoveMinutes(MONITORED_AT, -5),
      endValue: MONITORED_AT,
    },
    metricResult: data.results,
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    ...(data.series ? { seriesBreakdown: data.series } : {}),
  } as unknown as JSONObject;
}

function observe(
  monitorType: MonitorType,
  check: unknown,
): TelemetryObservation | null {
  return MonitorLogSummaryUtil.getTelemetryObservation({
    monitorType: monitorType,
    logBody:
      check === null || check === undefined
        ? (check as null | undefined)
        : storeAsMonitorLog(check),
  });
}

/*
 * What each telemetry signal's check stores, written out by hand so a type
 * whose evaluator stores another count has to be changed here too.
 */
const COUNTED: Array<{
  monitorType: MonitorType;
  key: string;
  kind: TelemetryObservationKind;
}> = [
  {
    monitorType: MonitorType.Logs,
    key: "logCount",
    kind: TelemetryObservationKind.Logs,
  },
  {
    monitorType: MonitorType.Traces,
    key: "spanCount",
    kind: TelemetryObservationKind.Spans,
  },
  {
    monitorType: MonitorType.Exceptions,
    key: "exceptionCount",
    kind: TelemetryObservationKind.Exceptions,
  },
  {
    monitorType: MonitorType.Profiles,
    key: "profileCount",
    kind: TelemetryObservationKind.Profiles,
  },
  {
    monitorType: MonitorType.SecurityEvents,
    key: "securityEventCount",
    kind: TelemetryObservationKind.SecurityEvents,
  },
  {
    monitorType: MonitorType.Llm,
    key: "llmBadAnswerCount",
    kind: TelemetryObservationKind.BadAiAnswers,
  },
];

const ALL_MONITOR_TYPES: Array<MonitorType> = Object.values(MonitorType);

describe("MonitorTypeHelper.hasMonitoringLogs", () => {
  it("gives every monitor type but Manual its Monitoring Logs", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      expect({
        monitorType,
        hasMonitoringLogs: MonitorTypeHelper.hasMonitoringLogs(monitorType),
      }).toEqual({
        monitorType,
        hasMonitoringLogs: monitorType !== MonitorType.Manual,
      });
    }
  });

  it("gives every telemetry monitor - metric-backed ones included - its logs", () => {
    const telemetryTypes: Array<MonitorType> =
      MonitorTypeHelper.getTelemetryMonitorTypes();

    expect(telemetryTypes).toContain(MonitorType.Metrics);
    expect(telemetryTypes).toContain(MonitorType.Kubernetes);

    for (const monitorType of telemetryTypes) {
      expect(MonitorTypeHelper.hasMonitoringLogs(monitorType)).toBe(true);
    }
  });
});

describe("MonitorLogSummaryUtil.getTelemetryObservation - counted signals", () => {
  it.each(COUNTED)(
    "reads a $monitorType check's $key",
    ({
      monitorType,
      key,
      kind,
    }: {
      monitorType: MonitorType;
      key: string;
      kind: TelemetryObservationKind;
    }) => {
      expect(observe(monitorType, { ...base(), [key]: 12 })).toEqual({
        kind,
        count: 12,
      });
      expect(observe(monitorType, { ...base(), [key]: 1 })).toEqual({
        kind,
        count: 1,
      });
    },
  );

  it("says a count of 0 is 0, not nothing - a service that stopped logging", () => {
    expect(observe(MonitorType.Logs, { ...base(), logCount: 0 })).toEqual({
      kind: TelemetryObservationKind.Logs,
      count: 0,
    });
  });

  it("reads a grouped logs check's total, across every group", () => {
    expect(
      observe(MonitorType.Logs, {
        ...base(),
        logCount: 412,
        groupByAttributes: ["service.name"],
        groupBreakdown: [
          { groupKey: "a", logCount: 400 },
          { groupKey: "b", logCount: 12 },
        ],
        totalGroupCount: 2,
      }),
    ).toEqual({ kind: TelemetryObservationKind.Logs, count: 412 });
  });

  it("reads an AI / LLM check's bad answers, not every answer it looked at", () => {
    expect(
      observe(MonitorType.Llm, {
        ...base(),
        llmAnswerCount: 120,
        llmBadAnswerCount: 3,
        llmBadAnswerPercent: 2.5,
      }),
    ).toEqual({ kind: TelemetryObservationKind.BadAiAnswers, count: 3 });
  });

  it("reads each type's own count, not another type's a row happens to hold", () => {
    // A row written while the monitor was a Traces monitor.
    expect(observe(MonitorType.Logs, { ...base(), spanCount: 7 })).toBeNull();
    expect(
      observe(MonitorType.Exceptions, { ...base(), logCount: 7 }),
    ).toBeNull();
  });

  it("shows nothing for a count that is not a count", () => {
    for (const value of [-1, "12", null, Number.NaN, true, { n: 1 }]) {
      expect(
        MonitorLogSummaryUtil.getTelemetryObservation({
          monitorType: MonitorType.Logs,
          logBody: { logCount: value } as unknown as JSONObject,
        }),
      ).toBeNull();
    }
  });

  it("reads a fractional count down to a whole one", () => {
    expect(
      MonitorLogSummaryUtil.getTelemetryObservation({
        monitorType: MonitorType.Traces,
        logBody: { spanCount: 4.7 },
      }),
    ).toEqual({ kind: TelemetryObservationKind.Spans, count: 4 });
  });
});

describe("MonitorLogSummaryUtil.getTelemetryObservation - metric-backed monitors", () => {
  it("counts the data points an ungrouped check read, over every query", () => {
    expect(
      observe(
        MonitorType.Metrics,
        metricCheck({ results: [aggregated(5), aggregated(3)] }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.MetricDataPoints, count: 8 });
  });

  it("says a check that read nothing read no data", () => {
    expect(
      observe(
        MonitorType.Metrics,
        metricCheck({ results: [aggregated(0), aggregated(0)] }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.NoMetricData, count: 0 });

    expect(observe(MonitorType.Metrics, metricCheck({ results: [] }))).toEqual({
      kind: TelemetryObservationKind.NoMetricData,
      count: 0,
    });
  });

  it("counts a grouped check's series, leaving out the ones that stopped reporting", () => {
    expect(
      observe(
        MonitorType.Kubernetes,
        metricCheck({
          results: [aggregated(6, { "k8s.pod.name": "api-1" })],
          series: [
            {
              fingerprint: "pod=api-1",
              labels: { "k8s.pod.name": "api-1" },
              aggregatedResults: [aggregated(2)],
            },
            {
              fingerprint: "pod=api-2",
              labels: { "k8s.pod.name": "api-2" },
              aggregatedResults: [aggregated(0), aggregated(4)],
            },
            {
              fingerprint: "pod=api-3",
              labels: { "k8s.pod.name": "api-3" },
              aggregatedResults: [aggregated(1)],
            },
            // A host the worker seeded because it went quiet: no data.
            {
              fingerprint: "pod=api-4",
              labels: { "k8s.pod.name": "api-4" },
              aggregatedResults: [aggregated(0)],
            },
          ],
        }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.MetricSeries, count: 3 });
  });

  it("says a grouped check whose every series went quiet read no data", () => {
    expect(
      observe(
        MonitorType.Host,
        metricCheck({
          results: [aggregated(0)],
          series: [
            {
              fingerprint: "host=web-1",
              labels: { "host.name": "web-1" },
              aggregatedResults: [aggregated(0)],
            },
          ],
        }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.NoMetricData, count: 0 });
  });

  it("falls back to the data points when the series hold none but the queries do", () => {
    expect(
      observe(
        MonitorType.Metrics,
        metricCheck({
          results: [aggregated(4)],
          series: [],
        }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.MetricDataPoints, count: 4 });
  });

  it("reads every metric-backed type the same way", () => {
    const metricBacked: Array<MonitorType> =
      MonitorTypeHelper.getMetricBackedMonitorTypes();

    expect(metricBacked.length).toBeGreaterThan(5);

    for (const monitorType of metricBacked) {
      expect({
        monitorType,
        observation: observe(
          monitorType,
          metricCheck({ results: [aggregated(2)] }),
        ),
      }).toEqual({
        monitorType,
        observation: {
          kind: TelemetryObservationKind.MetricDataPoints,
          count: 2,
        },
      });
    }
  });

  it("shows nothing for a body with no metric results at all", () => {
    expect(observe(MonitorType.Metrics, base())).toBeNull();
    // A Logs check stored before the monitor became a Metrics monitor.
    expect(
      observe(MonitorType.Metrics, { ...base(), logCount: 12 }),
    ).toBeNull();
  });

  it("skips results and series that are not shaped as stored", () => {
    expect(
      MonitorLogSummaryUtil.getTelemetryObservation({
        monitorType: MonitorType.Metrics,
        logBody: {
          metricResult: [
            null,
            "x",
            { data: "not points" },
            { data: [{ value: 1 }] },
          ],
          seriesBreakdown: [null, 7, { aggregatedResults: "none" }],
        } as unknown as JSONObject,
      }),
    ).toEqual({ kind: TelemetryObservationKind.MetricDataPoints, count: 1 });
  });
});

describe("MonitorLogSummaryUtil.getTelemetryObservation - what it leaves alone", () => {
  it("has an observation for every telemetry type's own check", () => {
    for (const monitorType of MonitorTypeHelper.getTelemetryMonitorTypes()) {
      const counted: { key: string } | undefined = COUNTED.find(
        (entry: { monitorType: MonitorType }): boolean => {
          return entry.monitorType === monitorType;
        },
      );

      const check: JSONObject = counted
        ? { ...base(), [counted.key]: 3 }
        : metricCheck({ results: [aggregated(3)] });

      expect({
        monitorType,
        observed: observe(monitorType, check) !== null,
      }).toEqual({ monitorType, observed: true });
    }
  });

  it("has none for a monitor that is not a telemetry monitor", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      if (MonitorTypeHelper.isTelemetryMonitor(monitorType)) {
        continue;
      }

      expect(
        observe(monitorType, {
          ...base(),
          logCount: 12,
          metricResult: [aggregated(2)],
        }),
      ).toBeNull();
    }
  });

  it("has none for an empty body", () => {
    for (const logBody of [null, undefined, [] as unknown as JSONObject]) {
      expect(
        MonitorLogSummaryUtil.getTelemetryObservation({
          monitorType: MonitorType.Logs,
          logBody: logBody,
        }),
      ).toBeNull();
    }
  });
});

describe("MonitorLogSummaryUtil.toSummaryInfoProps - a telemetry row's View Summary", () => {
  it("is a check that has run, with what it saw", () => {
    const props: MonitorSummaryInfoProps =
      MonitorLogSummaryUtil.toSummaryInfoProps({
        monitorType: MonitorType.Metrics,
        logBody: storeAsMonitorLog(metricCheck({ results: [aggregated(4)] })),
        monitoredAt: MONITORED_AT,
      });

    expect(props.telemetryMonitorSummary).toEqual({
      lastCheckedAt: MONITORED_AT,
      isPastCheck: true,
      observation: {
        kind: TelemetryObservationKind.MetricDataPoints,
        count: 4,
      },
    });
    // Why it matched, with the numbers the criteria compared.
    expect(props.evaluationSummary?.criteriaResults[0]?.message).toBe(
      "Metric value recorded latest 92.00% (expected above 80%).",
    );
  });

  it("is still a check that has run when what it saw cannot be read", () => {
    const props: MonitorSummaryInfoProps =
      MonitorLogSummaryUtil.toSummaryInfoProps({
        monitorType: MonitorType.Traces,
        logBody: storeAsMonitorLog(base()),
        monitoredAt: MONITORED_AT,
      });

    expect(props.telemetryMonitorSummary).toEqual({
      lastCheckedAt: MONITORED_AT,
      isPastCheck: true,
    });
  });

  it("leaves a probe check's summary as it was", () => {
    const props: MonitorSummaryInfoProps =
      MonitorLogSummaryUtil.toSummaryInfoProps({
        monitorType: MonitorType.Website,
        logBody: storeAsMonitorLog({
          ...base(),
          probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
          monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
          isOnline: true,
          responseCode: 200,
          monitoredAt: MONITORED_AT,
        }),
        monitoredAt: MONITORED_AT,
      });

    expect(props.telemetryMonitorSummary).toBeUndefined();
    expect(props.probeMonitorResponses).toHaveLength(1);
  });
});

/*
 * #10063: an ungrouped check's Observed counts the data points of what its
 * criteria compare. A formula's points are computed from its queries', so
 * counting both read "20 data points" for a 10 minute window of a Host
 * monitor whose template scales a ratio with a formula.
 */
describe("MonitorLogSummaryUtil.getTelemetryObservation - a formula is not counted on top of its query", () => {
  function query(alias: string): JSONObject {
    return {
      metricAliasData: { metricVariable: alias, title: alias },
      metricQueryData: { filterData: { metricName: `metric.${alias}` } },
    } as unknown as JSONObject;
  }

  function formula(alias: string, expression: string): JSONObject {
    return {
      metricAliasData: { metricVariable: alias, title: alias },
      metricFormulaData: { metricFormula: expression },
    } as unknown as JSONObject;
  }

  function checkWith(data: {
    queries: Array<JSONObject>;
    formulas: Array<JSONObject>;
    results: Array<{ data: Array<JSONObject> }>;
  }): JSONObject {
    return {
      ...metricCheck({ results: data.results }),
      metricViewConfig: {
        queryConfigs: data.queries,
        formulaConfigs: data.formulas,
      },
    } as unknown as JSONObject;
  }

  it("High Filesystem Usage over 10 minutes: 10 data points, the formula's, not 20", () => {
    expect(
      observe(
        MonitorType.Host,
        checkWith({
          queries: [query("host_filesystem_ratio")],
          formulas: [formula("host_filesystem", "host_filesystem_ratio * 100")],
          results: [aggregated(10), aggregated(10)],
        }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.MetricDataPoints, count: 10 });
  });

  it("a formula over two queries counts its own points, which the criteria compare", () => {
    expect(
      observe(
        MonitorType.Metrics,
        checkWith({
          queries: [query("a"), query("b")],
          formulas: [formula("c", "a / b * 100")],
          results: [aggregated(10), aggregated(10), aggregated(9)],
        }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.MetricDataPoints, count: 9 });
  });

  it("a query no formula is computed from is counted beside the formula", () => {
    expect(
      observe(
        MonitorType.Metrics,
        checkWith({
          queries: [query("a"), query("b")],
          formulas: [formula("c", "a * 100")],
          results: [aggregated(5), aggregated(3), aggregated(5)],
        }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.MetricDataPoints, count: 8 });
  });

  it("reads a formula's variables as the evaluator does: with a $, in any case", () => {
    expect(
      observe(
        MonitorType.Metrics,
        checkWith({
          queries: [query("Errors"), query("requests")],
          formulas: [formula("rate", "$errors / REQUESTS")],
          results: [aggregated(4), aggregated(4), aggregated(4)],
        }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.MetricDataPoints, count: 4 });
  });

  it("queries alone are all counted, as before", () => {
    expect(
      observe(
        MonitorType.Metrics,
        checkWith({
          queries: [query("a"), query("b")],
          formulas: [],
          results: [aggregated(5), aggregated(3)],
        }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.MetricDataPoints, count: 8 });
  });

  it("a body whose results do not line up with its queries and formulas is counted whole", () => {
    expect(
      observe(
        MonitorType.Metrics,
        checkWith({
          queries: [query("a")],
          formulas: [formula("b", "a * 2")],
          // A result short: trimmed, or written before formulas were stored.
          results: [aggregated(6)],
        }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.MetricDataPoints, count: 6 });
  });

  it("a formula that cannot be read leaves its queries counted", () => {
    expect(
      observe(
        MonitorType.Metrics,
        checkWith({
          queries: [query("a")],
          formulas: [formula("b", "a * (")],
          results: [aggregated(6), aggregated(0)],
        }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.MetricDataPoints, count: 6 });
  });

  it("a formula over a query that read nothing still says no data", () => {
    expect(
      observe(
        MonitorType.Host,
        checkWith({
          queries: [query("host_filesystem_ratio")],
          formulas: [formula("host_filesystem", "host_filesystem_ratio * 100")],
          results: [aggregated(0), aggregated(0)],
        }),
      ),
    ).toEqual({ kind: TelemetryObservationKind.NoMetricData, count: 0 });
  });

  it("a grouped check still counts its series", () => {
    expect(
      observe(MonitorType.Host, {
        ...checkWith({
          queries: [query("host_filesystem_ratio")],
          formulas: [formula("host_filesystem", "host_filesystem_ratio * 100")],
          results: [aggregated(10), aggregated(10)],
        }),
        seriesBreakdown: [
          {
            fingerprint: "mount=/",
            labels: { mountpoint: "/" },
            aggregatedResults: [aggregated(5), aggregated(5)],
          },
          {
            fingerprint: "mount=/data",
            labels: { mountpoint: "/data" },
            aggregatedResults: [aggregated(5), aggregated(5)],
          },
        ],
      }),
    ).toEqual({ kind: TelemetryObservationKind.MetricSeries, count: 2 });
  });
});
