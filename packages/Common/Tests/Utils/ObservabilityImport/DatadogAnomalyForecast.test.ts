import { describe, expect, test } from "@jest/globals";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  AnomalyDetectionSensitivity,
  EvaluateOverTimeType,
  FilterType,
  FORECAST_HORIZON_IN_HOURS_OPTIONS,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor, {
  MetricMonitorQueryLanguage,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleReadResult,
} from "../../../Types/Monitor/TelemetryAlertRule";
import ObjectID from "../../../Types/ObjectID";
import {
  AlertImportItem,
  AlertImportPlan,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportedAlertRule,
  ImportedAlertRuleKind,
  ImportedAlertSeverity,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { WINDOW_NEAREST_READ } from "../../../Utils/ObservabilityImport/AlertImportCommon";
import {
  AlertImportAction,
  AlertImportSeeds,
  IMPORTED_METRIC_QUERY_ALIAS,
  buildImportedMonitorSteps,
  getImportedMonitorType,
} from "../../../Utils/ObservabilityImport/AlertImportMonitorBuilder";
import {
  ANOMALY_ALGORITHM,
  ANOMALY_FIRST_VALUE,
  ANOMALY_LEARNS_FIRST,
  ANOMALY_METHOD_NOT_READ,
  ANOMALY_NOT_ONE_METRIC,
  ANOMALY_SCOPE_NOT_EXACT,
  FORECAST_ALGORITHM,
  FORECAST_BOUNDS,
  FORECAST_HORIZON_NEAREST,
  nearestForecastHorizonInHours,
  readAnomalySensitivity,
  readDatadogDurationMs,
  readFirstArgumentText,
} from "../../../Utils/ObservabilityImport/Datadog/DatadogMonitorFunctions";
import {
  MONITOR_RECOVERY_LEFT_OUT,
  MONITOR_WARNING_LEFT_OUT,
} from "../../../Utils/ObservabilityImport/Datadog/DatadogMonitors";
import {
  DATADOG_PERCENTILE_NOT_CONVERTED,
  DATADOG_READ_AS_GAUGE,
  DatadogMetricKind,
} from "../../../Utils/ObservabilityImport/Datadog/DatadogPromQL";
import {
  ALERT_SOURCE_KINDS,
  readImportSource,
} from "../../../Utils/ObservabilityImport/ImportSource";
import {
  ImportPlanOptions,
  planAlertImport,
} from "../../../Utils/ObservabilityImport/ObservabilityImport";
import { parsePromQL } from "../../../Utils/PromQL/PromQLParser";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { readFixture } from "./ImportFixtures";

/*
 * Datadog's anomaly and forecast monitors as OneUptime's own anomaly and
 * forecast conditions (issue #10325), held to Datadog's own monitors: the
 * NGINX and Postgres integrations' anomaly monitors and the Kubernetes
 * Cluster Autoscaler's forecast, as integrations-core ships them.
 */

const planOf: (
  monitor: string | Record<string, unknown>,
  options?: ImportPlanOptions,
) => AlertImportPlan = (
  monitor: string | Record<string, unknown>,
  options?: ImportPlanOptions,
): AlertImportPlan => {
  return planAlertImport(
    readImportSource({
      text:
        typeof monitor === "string"
          ? readFixture(monitor)
          : JSON.stringify(monitor),
      accepts: ALERT_SOURCE_KINDS,
    }),
    options,
  );
};

const onlyItem: (plan: AlertImportPlan) => AlertImportItem = (
  plan: AlertImportPlan,
): AlertImportItem => {
  expect(plan.items).toHaveLength(1);
  return plan.items[0] as AlertImportItem;
};

const texts: (notes: ReadonlyArray<ImportNote>) => Array<string> = (
  notes: ReadonlyArray<ImportNote>,
): Array<string> => {
  return notes.map((note: ImportNote): string => {
    return note.text;
  });
};

const anomalyMonitor: (
  query: string,
  options?: Record<string, unknown>,
) => Record<string, unknown> = (
  query: string,
  options?: Record<string, unknown>,
): Record<string, unknown> => {
  return {
    name: "Requests are unusual on {{host.name}}",
    type: "query alert",
    query,
    message:
      "{{#is_alert}}Requests on {{host.name}} look unusual.{{/is_alert}}",
    options: options || { thresholds: { critical: 1, critical_recovery: 0 } },
  };
};

const seeds: AlertImportSeeds = {
  operationalStatusId: ObjectID.generate(),
  degradedStatusId: ObjectID.generate(),
  offlineStatusId: ObjectID.generate(),
  rankedIncidentSeverityIds: [ObjectID.generate(), ObjectID.generate()],
  rankedAlertSeverityIds: [ObjectID.generate(), ObjectID.generate()],
};

const readBack: (steps: MonitorSteps) => TelemetryAlertRuleReadResult = (
  steps: MonitorSteps,
): TelemetryAlertRuleReadResult => {
  return TelemetryAlertRuleUtil.read({
    monitorType: MonitorType.Metrics,
    monitorStep: steps.data?.monitorStepsInstanceArray[0] as MonitorStep,
    defaultMonitorStatusId: seeds.operationalStatusId,
  });
};

describe("Datadog's own anomaly monitors", () => {
  test.each([
    [
      "datadog-monitor-nginx-5xx.json",
      "nginx.upstream.peers.responses.5xx",
      ["upstream"],
    ],
    [
      "datadog-monitor-nginx-upstream-latency.json",
      "nginx.upstream.peers.response_time",
      ["upstream"],
    ],
    [
      "datadog-monitor-postgres-replication-delay.json",
      "postgresql.replication_delay",
      [],
    ],
  ])(
    "%s reads %s with OneUptime's anomaly condition, its differences said",
    (fixture: string, metricName: string, groupBy: Array<string>) => {
      const item: AlertImportItem = onlyItem(planOf(fixture));

      expect(item.status).toBe(ImportItemStatus.Approximate);
      expect(item.rule?.kind).toBe(ImportedAlertRuleKind.MetricQuery);
      expect(item.rule?.metricQuery).toEqual({
        metricName,
        attributes: {},
        aggregation: MetricsAggregationType.Avg,
        groupByAttributeKeys: groupBy,
      });
      // direction='above'
      expect(item.rule?.filterType).toBe(FilterType.AnomalouslyHigh);
      // bounds of 2 deviations: OneUptime's 2 standard deviations.
      expect(item.rule?.anomalySensitivity).toBe(
        AnomalyDetectionSensitivity.High,
      );
      // alert_window='last_15m'
      expect(item.rule?.rollingTime).toBe(RollingTime.Past15Minutes);
      expect(item.rule?.aggregation).toBe(EvaluateOverTimeType.AnyValue);
      expect(item.rule?.promQL).toBe("");
      expect(item.notes).toEqual(
        expect.arrayContaining([
          {
            kind: ImportNoteKind.Approximation,
            text: ANOMALY_ALGORITHM,
            values: { algorithm: "basic", deviations: "2" },
          },
          {
            kind: ImportNoteKind.Approximation,
            text: ANOMALY_FIRST_VALUE,
            values: { share: "100%", window: "last_15m" },
          },
          { kind: ImportNoteKind.Info, text: ANOMALY_LEARNS_FIRST },
        ]),
      );
      // A recovery at 0 anomalous values is what OneUptime does on its own.
      expect(texts(item.notes)).not.toContain(MONITOR_RECOVERY_LEFT_OUT);
      // An anomaly is no query OneUptime AI could write.
      expect(item.aiCandidate).toBeUndefined();
    },
  );

  test("a group's tag in its text is the label its series are named by", () => {
    const item: AlertImportItem = onlyItem(
      planOf("datadog-monitor-nginx-5xx.json"),
    );

    expect(item.rule?.description).toContain("{{upstream}}");
  });
});

describe("an anomaly's query, direction and bounds", () => {
  test.each([
    ["direction='above'", FilterType.AnomalouslyHigh],
    ["direction='below'", FilterType.AnomalouslyLow],
    ["direction='both'", FilterType.Anomalous],
    // Datadog's default direction is both.
    ["alert_window='last_5m'", FilterType.Anomalous],
  ])("%s is %s", (argument: string, filterType: FilterType) => {
    const item: AlertImportItem = onlyItem(
      planOf(
        anomalyMonitor(
          `avg(last_1h):anomalies(avg:app.requests{*}, 'agile', 3, ${argument}, seasonality='weekly') >= 1`,
        ),
      ),
    );

    expect(item.rule?.filterType).toBe(filterType);
  });

  test("the bounds are read as the nearest sensitivity: 2 High, 3 Medium, 4 and more Low", () => {
    expect(readAnomalySensitivity(1)).toBe(AnomalyDetectionSensitivity.High);
    expect(readAnomalySensitivity(2)).toBe(AnomalyDetectionSensitivity.High);
    expect(readAnomalySensitivity(3)).toBe(AnomalyDetectionSensitivity.Medium);
    expect(readAnomalySensitivity(4)).toBe(AnomalyDetectionSensitivity.Low);
    expect(readAnomalySensitivity(6)).toBe(AnomalyDetectionSensitivity.Low);
    expect(readAnomalySensitivity(undefined)).toBe(
      AnomalyDetectionSensitivity.Medium,
    );
  });

  test("exact tags narrow the metric; the host is the resource's, as the Agent sends it", () => {
    const item: AlertImportItem = onlyItem(
      planOf(
        anomalyMonitor(
          "avg(last_4h):anomalies(sum:app.requests{env:prod,host:web-1} by {host,service}.as_count(), 'robust', 4, direction='below', alert_window='last_30m', interval=60, seasonality='daily') >= 0.8",
        ),
      ),
    );

    expect(item.rule?.metricQuery).toEqual({
      metricName: "app.requests",
      attributes: { env: "prod", "resource.host.name": "web-1" },
      aggregation: MetricsAggregationType.Sum,
      groupByAttributeKeys: ["resource.host.name", "resource.service.name"],
    });
    expect(item.rule?.filterType).toBe(FilterType.AnomalouslyLow);
    expect(item.rule?.anomalySensitivity).toBe(AnomalyDetectionSensitivity.Low);
    expect(item.rule?.rollingTime).toBe(RollingTime.Past30Minutes);
    expect(item.notes).toContainEqual({
      kind: ImportNoteKind.Approximation,
      text: ANOMALY_FIRST_VALUE,
      values: { share: "80%", window: "last_30m" },
    });
    // The alert's text names the series by the attributes it is grouped by.
    expect(item.rule?.title).toBe(
      "Requests are unusual on {{resource.host.name}}",
    );
  });

  test("what a builder query cannot read is not converted, each with why", () => {
    for (const [query, reason] of [
      [
        "avg(last_1h):anomalies(avg:a.b{*} / avg:a.c{*}, 'basic', 2) >= 1",
        ANOMALY_NOT_ONE_METRIC,
      ],
      [
        "avg(last_1h):anomalies(avg:a.b{host:web-*}, 'basic', 2) >= 1",
        ANOMALY_SCOPE_NOT_EXACT,
      ],
      [
        "avg(last_1h):anomalies(avg:a.b{!env:dev}, 'basic', 2) >= 1",
        ANOMALY_SCOPE_NOT_EXACT,
      ],
      [
        "avg(last_1h):anomalies(avg:a.b{env:prod OR env:dev}, 'basic', 2) >= 1",
        ANOMALY_SCOPE_NOT_EXACT,
      ],
      [
        "avg(last_1h):anomalies(avg:a.b{*}.rollup(max, 60), 'basic', 2) >= 1",
        ANOMALY_METHOD_NOT_READ,
      ],
      [
        "avg(last_1h):anomalies(p99:a.b{*}, 'basic', 2) >= 1",
        DATADOG_PERCENTILE_NOT_CONVERTED,
      ],
    ] as Array<[string, string]>) {
      const item: AlertImportItem = onlyItem(planOf(anomalyMonitor(query)));

      expect(item.status).toBe(ImportItemStatus.NotConverted);
      expect(texts(item.notes)).toEqual([reason]);
      expect(item.rule).toBeUndefined();
      expect(item.aiCandidate).toBeUndefined();
    }
  });

  test("an alert window OneUptime has no window of reads the nearest longer, said", () => {
    const item: AlertImportItem = onlyItem(
      planOf(
        anomalyMonitor(
          "avg(last_1d):anomalies(avg:a.b{*}, 'basic', 2, alert_window='last_20m') >= 1",
        ),
      ),
    );

    expect(item.rule?.rollingTime).toBe(RollingTime.Past30Minutes);
    expect(item.notes).toContainEqual({
      kind: ImportNoteKind.Approximation,
      text: WINDOW_NEAREST_READ,
      values: { source: "last_20m", window: RollingTime.Past30Minutes },
    });
  });

  test("a recovery above 0 and a warning are said", () => {
    const item: AlertImportItem = onlyItem(
      planOf(
        anomalyMonitor(
          "avg(last_1h):anomalies(avg:a.b{*}, 'basic', 2, alert_window='last_15m') >= 1",
          {
            thresholds: { critical: 1, critical_recovery: 0.5, warning: 0.8 },
          },
        ),
      ),
    );

    expect(texts(item.notes)).toEqual(
      expect.arrayContaining([
        MONITOR_RECOVERY_LEFT_OUT,
        MONITOR_WARNING_LEFT_OUT,
      ]),
    );
  });
});

describe("Datadog's forecast monitors", () => {
  test("the Kubernetes Cluster Autoscaler's forecast reads its query as PromQL, with OneUptime's forecast condition", () => {
    const item: AlertImportItem = onlyItem(
      planOf("datadog-monitor-kubernetes-autoscaler-forecast.json", {
        knownMetricKinds: new Map<string, DatadogMetricKind>([
          [
            "cluster_autoscaler.cluster_autoscaler_unneeded_nodes_count",
            DatadogMetricKind.Gauge,
          ],
        ]),
      }),
    );

    expect(item.status).toBe(ImportItemStatus.Approximate);
    expect(item.rule?.kind).toBe(ImportedAlertRuleKind.PromQL);
    expect(item.rule?.promQL).toBe(
      "avg by (kube_cluster_name, env) (avg_over_time(cluster_autoscaler_cluster_autoscaler_unneeded_nodes_count[1m]))",
    );
    // max(next_12h) ... >= 500
    expect(item.rule?.filterType).toBe(FilterType.ForecastAbove);
    expect(item.rule?.threshold).toBe(500);
    expect(item.rule?.forecastHorizonInHours).toBe(12);
    // history='1mo'
    expect(item.rule?.rollingTime).toBe(RollingTime.Past30Days);
    expect(item.notes).toEqual([
      {
        kind: ImportNoteKind.Approximation,
        text: FORECAST_ALGORITHM,
        values: { algorithm: "linear" },
      },
      { kind: ImportNoteKind.Approximation, text: FORECAST_BOUNDS },
      // critical_recovery: 400
      { kind: ImportNoteKind.Approximation, text: MONITOR_RECOVERY_LEFT_OUT },
    ]);
    expect(texts(item.notes)).not.toContain(DATADOG_READ_AS_GAUGE);
    expect(() => {
      parsePromQL(item.rule?.promQL || "");
    }).not.toThrow();
  });

  test("min(...) <= is a forecast below; a horizon OneUptime does not offer is the nearest, said; a seasonal forecast reads a week", () => {
    const item: AlertImportItem = onlyItem(
      planOf({
        name: "Free disk is running out",
        type: "query alert",
        query:
          "min(next_2w):forecast(min:system.disk.free{device:/data} by {host}, 'seasonal', 2, interval='60m', seasonality='weekly') <= 10000000000",
        message: "Disk on {{host.name}} is filling up.",
        options: { thresholds: { critical: 10000000000 } },
      }),
    );

    expect(item.rule?.filterType).toBe(FilterType.ForecastBelow);
    expect(item.rule?.forecastHorizonInHours).toBe(336);
    expect(item.rule?.rollingTime).toBe(RollingTime.Past7Days);
    /*
     * min(next_2w) says which edge of the forecast is compared, not how
     * the query reads its points: each minute's average, as Datadog rolls
     * a forecast's points up.
     */
    expect(item.rule?.promQL).toBe(
      'min by (resource_host_name) (avg_over_time(system_disk_free{device="/data"}[1m]))',
    );
    expect(texts(item.notes)).toContain(FORECAST_ALGORITHM);
    expect(item.rule?.description).toBe(
      "Disk on {{resource_host_name}} is filling up.",
    );

    const odd: AlertImportItem = onlyItem(
      planOf({
        name: "Queue fills",
        type: "query alert",
        query:
          "max(next_5d):forecast(avg:queue.depth{*}, 'linear', 1, history='3w') >= 1000",
        options: {},
      }),
    );

    expect(odd.rule?.forecastHorizonInHours).toBe(168);
    expect(odd.notes).toContainEqual({
      kind: ImportNoteKind.Approximation,
      text: FORECAST_HORIZON_NEAREST,
      values: { source: "next_5d" },
    });
    // Three weeks: the nearest longer window, a month.
    expect(odd.rule?.rollingTime).toBe(RollingTime.Past30Days);
    expect(odd.notes).toContainEqual({
      kind: ImportNoteKind.Approximation,
      text: WINDOW_NEAREST_READ,
      values: { source: "3w", window: RollingTime.Past30Days },
    });
  });

  test("a forecast whose query PromQL cannot say is offered to OneUptime AI, for a monitor", () => {
    const item: AlertImportItem = onlyItem(
      planOf({
        name: "Errors keep growing",
        type: "query alert",
        query:
          "max(next_1d):forecast(cumsum(sum:app.errors{*}.as_count()), 'linear', 1) >= 100",
        options: {},
      }),
    );

    expect(item.status).toBe(ImportItemStatus.NotConverted);
    expect(item.aiCandidate?.query).toBe(
      "cumsum(sum:app.errors{*}.as_count())",
    );
    expect(item.aiCandidate?.isForMonitor).toBe(true);
  });
});

describe("Datadog's durations and a call's first argument", () => {
  test("durations read as Datadog writes them", () => {
    expect(readDatadogDurationMs("last_15m")).toBe(15 * 60 * 1000);
    expect(readDatadogDurationMs("next_1w")).toBe(7 * 86400 * 1000);
    expect(readDatadogDurationMs("1mo")).toBe(30 * 86400 * 1000);
    expect(readDatadogDurationMs("60")).toBe(60 * 1000);
    expect(readDatadogDurationMs("12h")).toBe(12 * 3600 * 1000);
    expect(readDatadogDurationMs("soon")).toBeNaN();
    expect(readDatadogDurationMs("")).toBeNaN();
  });

  test("a call's first argument, its brackets and quotes stepped over", () => {
    expect(
      readFirstArgumentText(
        "forecast(avg:a.b{env:prod,role:db} by {host,device}, 'linear', 1)",
      ),
    ).toBe("avg:a.b{env:prod,role:db} by {host,device}");
    expect(
      readFirstArgumentText("forecast(top(query1, 5, 'mean', 'desc'))"),
    ).toBe("top(query1, 5, 'mean', 'desc')");
    expect(readFirstArgumentText("forecast(a{x:\"(,)\"}, 'linear')")).toBe(
      'a{x:"(,)"}',
    );
    expect(readFirstArgumentText("avg:a.b{*}")).toBeUndefined();
    expect(readFirstArgumentText("forecast(")).toBeUndefined();
  });

  test("the nearest horizon is one OneUptime offers, whatever the forecast's", () => {
    const random: SeededRandom = seededRandom(10325);

    for (let draw: number = 0; draw < 500; draw++) {
      const hours: number = 1 + random(24 * 120);
      const nearest: number = nearestForecastHorizonInHours(hours);

      expect(FORECAST_HORIZON_IN_HOURS_OPTIONS).toContain(nearest);

      for (const option of FORECAST_HORIZON_IN_HOURS_OPTIONS) {
        expect(Math.abs(nearest - hours)).toBeLessThanOrEqual(
          Math.abs(option - hours),
        );
      }
    }

    for (const option of FORECAST_HORIZON_IN_HOURS_OPTIONS) {
      expect(nearestForecastHorizonInHours(option)).toBe(option);
    }
  });
});

describe("the monitor an anomaly or a forecast becomes", () => {
  const anomaly: ImportedAlertRule = {
    kind: ImportedAlertRuleKind.MetricQuery,
    promQL: "",
    metricQuery: {
      metricName: "nginx.upstream.peers.responses.5xx",
      attributes: { env: "prod" },
      aggregation: MetricsAggregationType.Avg,
      groupByAttributeKeys: ["upstream"],
    },
    filterType: FilterType.AnomalouslyHigh,
    threshold: 1,
    rollingTime: RollingTime.Past15Minutes,
    aggregation: EvaluateOverTimeType.AnyValue,
    anomalySensitivity: AnomalyDetectionSensitivity.High,
    onNoData: NoDataPolicy.Ignore,
    severity: ImportedAlertSeverity.Critical,
    title: "5xx errors on {{upstream}}",
    description: "More 5xx errors than usual.",
    monitorDescription: "More 5xx errors than usual.",
  };

  test("an anomaly: a Metrics monitor reading one metric with the query builder, whose rule the form reads back", () => {
    const steps: MonitorSteps = buildImportedMonitorSteps({
      rule: anomaly,
      monitorName: "5xx errors",
      seeds,
      action: AlertImportAction.Alert,
    });

    expect(getImportedMonitorType(anomaly)).toBe(MonitorType.Metrics);
    expect(
      MonitorSteps.getValidationError(steps, MonitorType.Metrics),
    ).toBeNull();

    const metric: MonitorStepMetricMonitor | undefined =
      steps.data?.monitorStepsInstanceArray[0]?.data?.metricMonitor;

    expect(metric?.queryLanguage).toBe(MetricMonitorQueryLanguage.Builder);
    expect(metric?.rollingTime).toBe(RollingTime.Past15Minutes);
    expect(metric?.metricViewConfig.queryConfigs).toHaveLength(1);
    expect(
      metric?.metricViewConfig.queryConfigs[0]?.metricQueryData.filterData,
    ).toEqual({
      metricName: "nginx.upstream.peers.responses.5xx",
      attributes: { env: "prod" },
      aggegationType: MetricsAggregationType.Avg,
      aggregateBy: {},
    });
    expect(
      metric?.metricViewConfig.queryConfigs[0]?.metricQueryData
        .groupByAttributeKeys,
    ).toEqual(["upstream"]);

    const read: TelemetryAlertRuleReadResult = readBack(steps);

    expect(read.problem).toBeNull();

    const written: TelemetryAlertRule | null = read.rule;

    expect(written?.filterType).toBe(FilterType.AnomalouslyHigh);
    expect(written?.threshold).toBeUndefined();
    expect(written?.metricAlias).toBe(IMPORTED_METRIC_QUERY_ALIAS);
    expect(written?.anomalyDetection?.sensitivity).toBe(
      AnomalyDetectionSensitivity.High,
    );
    expect(written?.metricAggregationType).toBe(EvaluateOverTimeType.AnyValue);
    expect(written?.alert?.title).toBe("5xx errors on {{upstream}}");
  });

  test("a forecast: a PromQL step whose rule keeps its horizon", () => {
    const steps: MonitorSteps = buildImportedMonitorSteps({
      rule: {
        promQL:
          "avg by (resource_host_name) (avg_over_time(system_disk_in_use[1m]))",
        filterType: FilterType.ForecastAbove,
        threshold: 0.9,
        rollingTime: RollingTime.Past7Days,
        aggregation: EvaluateOverTimeType.AllValues,
        forecastHorizonInHours: 168,
        onNoData: NoDataPolicy.Ignore,
        severity: ImportedAlertSeverity.Warning,
        title: "Disk fills on {{resource_host_name}}",
        description: "The disk is filling up.",
        monitorDescription: "The disk is filling up.",
      },
      monitorName: "Disk fills",
      seeds,
      action: AlertImportAction.Incident,
    });

    expect(
      MonitorSteps.getValidationError(steps, MonitorType.Metrics),
    ).toBeNull();
    expect(
      steps.data?.monitorStepsInstanceArray[0]?.data?.metricMonitor
        ?.queryLanguage,
    ).toBe(MetricMonitorQueryLanguage.PromQL);

    const written: TelemetryAlertRule | null = readBack(steps).rule;

    expect(written?.filterType).toBe(FilterType.ForecastAbove);
    expect(written?.threshold).toBe(0.9);
    expect(written?.forecast?.horizonInHours).toBe(168);
    expect(written?.incident?.incidentSeverityId?.toString()).toBe(
      seeds.rankedIncidentSeverityIds[1]?.toString(),
    );
  });
});
