import { describe, expect, test } from "@jest/globals";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { getAllCloudAppAlertTemplates } from "../../../Types/Monitor/CloudAppAlertTemplates";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  RequestHealthAlertTemplate,
  RequestHealthAlertTemplateArgs,
  RequestHealthScope,
  buildRequestLatencyAlertTemplate,
  buildSpanCountAlertTemplate,
  readRequestHealthTelemetryFilters,
} from "../../../Types/Monitor/RequestHealthAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";

/*
 * The shared request-health builders (#9307): every product whose
 * telemetry is told apart by resource attributes builds its "failing,
 * slow, stopped" monitors here, so each must be scoped by exactly the
 * filter it is given, and name its resource the product's way.
 */

const SCOPE: RequestHealthScope = {
  titlePrefix: "[Thing]",
  resourceNoun: "thing",
};

const FILTERS: Record<string, string> = { "resource.faas.name": "orders" };

function argsFor(
  filters: Record<string, unknown>,
): RequestHealthAlertTemplateArgs {
  return {
    telemetryFilters: filters as Record<string, string>,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "orders",
  };
}

const ERRORS: RequestHealthAlertTemplate<
  "Errors",
  RequestHealthAlertTemplateArgs
> = buildSpanCountAlertTemplate({
  scope: SCOPE,
  id: "thing-errors",
  name: "Errors",
  summary: "It fails.",
  description: "Fires when it fails.",
  category: "Errors",
  severity: "Warning",
  spanStatuses: [SpanStatus.Error],
  lastXSecondsOfSpans: 600,
  unhealthyFilterType: FilterType.GreaterThan,
  threshold: 0,
  criteriaName: "Error spans detected",
  criteriaDescription: "Triggers on an error span.",
  incidentDescription: "It failed.",
});

const LATENCY: RequestHealthAlertTemplate<
  "Latency",
  RequestHealthAlertTemplateArgs
> = buildRequestLatencyAlertTemplate({
  scope: SCOPE,
  id: "thing-latency",
  name: "Slow",
  summary: "It is slow.",
  description: "Fires when it is slow.",
  category: "Latency",
  severity: "Critical",
  metricName: "some.duration",
  alias: "thing_p95",
  aggregationType: MetricsAggregationType.P95,
  thresholdMs: 1000,
  thresholdLabel: "1,000 ms",
  incidentDescription: "It is slow.",
});

function unhealthyOf(step: MonitorStep): MonitorCriteriaInstance {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;
}

describe("readRequestHealthTelemetryFilters", () => {
  test("keeps text filters with a key and a value", () => {
    expect(
      readRequestHealthTelemetryFilters({
        "resource.faas.name": "orders",
        " resource.cloud.region ": "eu-west-1",
      }),
    ).toEqual({
      "resource.faas.name": "orders",
      "resource.cloud.region": "eu-west-1",
    });
  });

  test("drops blank, non-text and malformed values", () => {
    expect(
      readRequestHealthTelemetryFilters({
        "resource.faas.name": "  ",
        count: 3,
        "": "x",
        nested: { a: "b" },
      }),
    ).toEqual({});
    expect(readRequestHealthTelemetryFilters(null)).toEqual({});
    expect(readRequestHealthTelemetryFilters(["a"])).toEqual({});
    expect(readRequestHealthTelemetryFilters("resource.x")).toEqual({});
  });
});

describe("buildSpanCountAlertTemplate", () => {
  test("counts the resource's own spans of the statuses given", () => {
    const step: MonitorStep = ERRORS.getMonitorStep(argsFor(FILTERS));

    expect(ERRORS.monitorType).toBe(MonitorType.Traces);
    expect(step.data!.traceMonitor!.attributes).toEqual(FILTERS);
    expect(step.data!.traceMonitor!.spanStatuses).toEqual([SpanStatus.Error]);
    expect(step.data!.traceMonitor!.lastXSecondsOfSpans).toBe(600);
    expect(step.data!.traceMonitor!.telemetryServiceIds).toEqual([]);
  });

  test("never filters on a value that is not text", () => {
    const step: MonitorStep = ERRORS.getMonitorStep(
      argsFor({ ...FILTERS, extra: 7 }),
    );

    expect(step.data!.traceMonitor!.attributes).toEqual(FILTERS);
  });

  test("names the resource the product's way and recovers", () => {
    const step: MonitorStep = ERRORS.getMonitorStep(argsFor(FILTERS));
    const instances: Array<MonitorCriteriaInstance> =
      step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

    expect(unhealthyOf(step).data!.incidents[0]!.title).toBe(
      "[Thing] Errors - orders",
    );
    expect(unhealthyOf(step).data!.filters[0]!.checkOn).toBe(CheckOn.SpanCount);
    expect(instances).toHaveLength(2);
    expect(instances[1]!.data!.filters[0]!.filterType).toBe(
      FilterType.LessThanOrEqualTo,
    );
  });
});

describe("buildRequestLatencyAlertTemplate", () => {
  test("reads the named histogram over the resource's filter", () => {
    const step: MonitorStep = LATENCY.getMonitorStep(argsFor(FILTERS));
    const query: any =
      step.data!.metricMonitor!.metricViewConfig.queryConfigs[0]!
        .metricQueryData.filterData;

    expect(LATENCY.monitorType).toBe(MonitorType.Metrics);
    expect(step.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past5Minutes,
    );
    expect(query.metricName).toBe("some.duration");
    expect(query.attributes).toEqual(FILTERS);
    expect(query.aggegationType).toBe(MetricsAggregationType.P95);
  });

  test("says its threshold and names the resource", () => {
    const step: MonitorStep = LATENCY.getMonitorStep(argsFor(FILTERS));

    expect(unhealthyOf(step).data!.name).toBe("Slow - 1,000 ms or worse");
    expect(unhealthyOf(step).data!.incidents[0]!.title).toBe(
      "[Thing] Slow - orders",
    );
  });
});

describe("one resource's monitors never cover another's", () => {
  test("the filter is part of what makes a monitor already created", () => {
    const fingerprint: (filters: Record<string, string>) => string = (
      filters: Record<string, string>,
    ): string => {
      return MonitorRecommendationUtil.serializeFingerprint(
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(
          ERRORS.getMonitorStep(argsFor(filters)),
        )!,
      );
    };

    expect(fingerprint(FILTERS)).toBe(fingerprint({ ...FILTERS }));
    expect(fingerprint(FILTERS)).not.toBe(
      fingerprint({ "resource.faas.name": "payments" }),
    );
  });
});

describe("App Platforms is built by the shared builders", () => {
  test("its five templates keep their ids, words and kinds", () => {
    expect(
      getAllCloudAppAlertTemplates().map(
        (template: { id: string; monitorType: MonitorType }) => {
          return `${template.id}:${template.monitorType}`;
        },
      ),
    ).toEqual([
      "cloud-app-failed-operations:Traces",
      "cloud-app-error-burst:Traces",
      "cloud-app-traffic-stopped:Traces",
      "cloud-app-latency-p95:Metrics",
      "cloud-app-latency-p99:Metrics",
    ]);
  });
});
