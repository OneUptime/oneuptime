import LogService from "../../Services/LogService";
import MetricService from "../../Services/MetricService";
import SpanService from "../../Services/SpanService";
import {
  TelemetryServiceMetadata,
  getScalarEntityKeyColumns,
} from "../../Services/OpenTelemetryIngestService";
import TelemetryUtil from "../Telemetry/Telemetry";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import { SpanKind, SpanStatus } from "../../../Models/AnalyticsModels/Span";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import LogSeverity, { LogSeverityNumber } from "../../../Types/Log/LogSeverity";
import MetricDashboardMetricType from "../../../Types/Metrics/MetricDashboardMetricType";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import ObjectID from "../../../Types/ObjectID";
import { SAMPLE_PROJECT_TELEMETRY_RETENTION_IN_DAYS } from "../../../Types/SampleProject/SampleProject";
import ServiceType from "../../../Types/Telemetry/ServiceType";

/*
 * THE SAMPLE'S TELEMETRY (issue #6808): a few thousand rows of logs, spans
 * and metrics for its one service, checkout-api, written once when the
 * sample is made, and the response times of its web monitors.
 *
 * They tell the sample's story: checkout-api answers in about 300 ms all
 * day, until 27 minutes ago, when a slow database query makes about one
 * request in five take 1.2 to 2.2 seconds and a few fail - what its open
 * incident, its alerts and its Degraded monitor are about. The last hour is
 * dense, so the Logs, Traces and Metrics pages' default hour is full; the
 * day before it is sparse.
 *
 * Every row is kept SAMPLE_PROJECT_TELEMETRY_RETENTION_IN_DAYS (its own
 * retentionDate), whatever the project's retention says, and every row is
 * deleted with the sample (SampleProjectAnalyticsData). Rows are built with
 * a seeded random number generator, so the same seed builds the same story.
 */

// When checkout got slow, in minutes before the sample was made.
export const SAMPLE_SLOWDOWN_STARTED_MINUTES_AGO: number = 27;

// One trace a minute in the last hour, one every 15 minutes in the 23 before it.
export const SAMPLE_DENSE_MINUTES: number = 60;
export const SAMPLE_SPARSE_HOURS: number = 23;
export const SAMPLE_SPARSE_STEP_MINUTES: number = 15;

// The service's metrics, by the names the Metrics dashboard template charts.
export const SAMPLE_SERVICE_METRICS: ReadonlyArray<{
  name: string;
  description: string;
  unit: string;
}> = [
  {
    name: MetricDashboardMetricType.HttpRequestCount,
    description: "Requests checkout-api answered.",
    unit: "{request}",
  },
  {
    name: MetricDashboardMetricType.HttpRequestDuration,
    description: "How long checkout-api took to answer.",
    unit: "ms",
  },
  {
    name: MetricDashboardMetricType.HttpRequestErrorRate,
    description: "The share of requests checkout-api answered with an error.",
    unit: "%",
  },
  {
    name: MetricDashboardMetricType.HttpActiveRequests,
    description: "Requests checkout-api was working on.",
    unit: "{request}",
  },
  {
    name: MetricDashboardMetricType.HttpResponseSize,
    description: "The size of checkout-api's answers.",
    unit: "By",
  },
  {
    name: MetricDashboardMetricType.SystemCpuUtilization,
    description: "The CPU checkout-api's host used.",
    unit: "1",
  },
  {
    name: MetricDashboardMetricType.SystemMemoryUsage,
    description: "The memory checkout-api's host used.",
    unit: "By",
  },
];

export interface SampleTelemetryMonitor {
  monitorId: ObjectID;
  name: string;
  // Milliseconds it usually answers in.
  baseResponseTimeInMs: number;
  // Whether it slowed down with checkout.
  isSlowNow: boolean;
}

export interface SampleTelemetryRows {
  logs: Array<JSONObject>;
  spans: Array<JSONObject>;
  metrics: Array<JSONObject>;
}

// A small seeded generator (mulberry32): the same seed, the same story.
export const createSeededRandom: (seed: number) => () => number = (
  seed: number,
): (() => number) => {
  let state: number = seed >>> 0;

  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t: number = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randomHex: (random: () => number, length: number) => string = (
  random: () => number,
  length: number,
): string => {
  let hex: string = "";

  while (hex.length < length) {
    hex += Math.floor(random() * 0x100000000)
      .toString(16)
      .padStart(8, "0");
  }

  return hex.slice(0, length);
};

const minutesBefore: (now: Date, minutes: number) => Date = (
  now: Date,
  minutes: number,
): Date => {
  return new Date(now.getTime() - minutes * 60 * 1000);
};

const toUnixNanoText: (date: Date) => string = (date: Date): string => {
  return `${BigInt(date.getTime()) * BigInt(1_000_000)}`;
};

export default class SampleProjectTelemetry {
  /*
   * The minutes before the sample was made at which a trace starts: every
   * minute of the last hour, then every quarter hour of the day before.
   */
  public static getTraceMinutesAgo(): Array<number> {
    const minutes: Array<number> = [];

    for (let minute: number = 1; minute <= SAMPLE_DENSE_MINUTES; minute++) {
      minutes.push(minute);
    }

    for (
      let minute: number = SAMPLE_DENSE_MINUTES + SAMPLE_SPARSE_STEP_MINUTES;
      minute <= SAMPLE_DENSE_MINUTES + SAMPLE_SPARSE_HOURS * 60;
      minute += SAMPLE_SPARSE_STEP_MINUTES
    ) {
      minutes.push(minute);
    }

    return minutes;
  }

  public static buildRows(data: {
    projectId: ObjectID;
    service: TelemetryServiceMetadata;
    monitors: Array<SampleTelemetryMonitor>;
    now: Date;
    seed?: number | undefined;
  }): SampleTelemetryRows {
    const random: () => number = createSeededRandom(data.seed ?? 6808);
    const createdAt: string = OneUptimeDate.toClickhouseDateTime(data.now);
    const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(
        data.now,
        SAMPLE_PROJECT_TELEMETRY_RETENTION_IN_DAYS,
      ),
    );
    const projectId: string = data.projectId.toString();
    const serviceId: string = data.service.primaryEntityId.toString();
    const serviceName: string = data.service.serviceName;

    const serviceColumns: JSONObject = {
      projectId: projectId,
      primaryEntityId: serviceId,
      primaryEntityType: data.service.primaryEntityType,
      entityKeys: data.service.entityKeys || [],
      ...getScalarEntityKeyColumns(data.service),
    };

    const resourceAttributes: JSONObject = {
      "resource.service.name": serviceName,
      "resource.deployment.environment": "production",
      "resource.service.version": "2.15.0",
    };

    const rows: SampleTelemetryRows = { logs: [], spans: [], metrics: [] };

    const isSlowAt: (minutesAgo: number) => boolean = (
      minutesAgo: number,
    ): boolean => {
      return minutesAgo <= SAMPLE_SLOWDOWN_STARTED_MINUTES_AGO;
    };

    // TRACES AND THEIR LOGS: one checkout request each.
    for (const minutesAgo of SampleProjectTelemetry.getTraceMinutesAgo()) {
      const startedAt: Date = new Date(
        minutesBefore(data.now, minutesAgo).getTime() +
          Math.floor(random() * 50_000),
      );
      const isSlow: boolean = isSlowAt(minutesAgo) && random() < 0.2;
      const isError: boolean = isSlowAt(minutesAgo) && random() < 0.08;

      const queryMs: number = isSlow
        ? 900 + Math.floor(random() * 1000)
        : 30 + Math.floor(random() * 40);
      const pricingMs: number = 20 + Math.floor(random() * 30);
      const paymentMs: number = isError
        ? 5000
        : 120 + Math.floor(random() * 80);
      const totalMs: number = 15 + queryMs + pricingMs + paymentMs;

      const traceId: string = randomHex(random, 32);
      const rootSpanId: string = randomHex(random, 16);

      const span: (spanData: {
        spanId: string;
        parentSpanId: string;
        name: string;
        kind: SpanKind;
        offsetMs: number;
        durationMs: number;
        isError: boolean;
        attributes: JSONObject;
      }) => JSONObject = (spanData: {
        spanId: string;
        parentSpanId: string;
        name: string;
        kind: SpanKind;
        offsetMs: number;
        durationMs: number;
        isError: boolean;
        attributes: JSONObject;
      }): JSONObject => {
        const spanStart: Date = new Date(
          startedAt.getTime() + spanData.offsetMs,
        );
        const spanEnd: Date = new Date(
          spanStart.getTime() + spanData.durationMs,
        );
        const isRootSpan: boolean = spanData.parentSpanId === "";
        const attributes: JSONObject = {
          ...resourceAttributes,
          ...spanData.attributes,
        };

        return {
          _id: ObjectID.generateTimeOrdered().toString(),
          createdAt: createdAt,
          ...serviceColumns,
          startTime: OneUptimeDate.toClickhouseDateTime(spanStart),
          endTime: OneUptimeDate.toClickhouseDateTime(spanEnd),
          startTimeUnixNano: toUnixNanoText(spanStart),
          endTimeUnixNano: toUnixNanoText(spanEnd),
          durationUnixNano: `${BigInt(spanData.durationMs) * BigInt(1_000_000)}`,
          traceId: traceId,
          spanId: spanData.spanId,
          sessionId: "",
          parentSpanId: spanData.parentSpanId,
          traceState: "",
          attributes: attributes,
          attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
          statusCode: spanData.isError ? SpanStatus.Error : SpanStatus.Ok,
          statusMessage: spanData.isError
            ? "Payment provider did not answer in 5 seconds"
            : "",
          name: spanData.name,
          kind: spanData.kind,
          events: [],
          links: [],
          hasException: spanData.isError,
          isRootSpan: isRootSpan,
          isEntrySpan: isRootSpan || spanData.kind === SpanKind.Server,
          isLlmSpan: false,
          retentionDate: retentionDate,
        };
      };

      rows.spans.push(
        span({
          spanId: rootSpanId,
          parentSpanId: "",
          name: "POST /checkout",
          kind: SpanKind.Server,
          offsetMs: 0,
          durationMs: totalMs,
          isError: isError,
          attributes: {
            "http.request.method": "POST",
            "http.route": "/checkout",
            "http.response.status_code": isError ? 502 : 200,
          },
        }),
        span({
          spanId: randomHex(random, 16),
          parentSpanId: rootSpanId,
          name: "SELECT orders",
          kind: SpanKind.Client,
          offsetMs: 5,
          durationMs: queryMs,
          isError: false,
          attributes: {
            "db.system": "postgresql",
            "db.operation.name": "SELECT",
            "db.collection.name": "orders",
          },
        }),
        span({
          spanId: randomHex(random, 16),
          parentSpanId: rootSpanId,
          name: "price cart",
          kind: SpanKind.Internal,
          offsetMs: 10 + queryMs,
          durationMs: pricingMs,
          isError: false,
          attributes: {},
        }),
        span({
          spanId: randomHex(random, 16),
          parentSpanId: rootSpanId,
          name: "POST /payments/charge",
          kind: SpanKind.Client,
          offsetMs: 12 + queryMs + pricingMs,
          durationMs: paymentMs,
          isError: isError,
          attributes: {
            "http.request.method": "POST",
            "server.address": "api.shop.example.com",
          },
        }),
      );

      const log: (logData: {
        offsetMs: number;
        severity: LogSeverity;
        body: string;
        attributes: JSONObject;
      }) => JSONObject = (logData: {
        offsetMs: number;
        severity: LogSeverity;
        body: string;
        attributes: JSONObject;
      }): JSONObject => {
        const loggedAt: Date = new Date(startedAt.getTime() + logData.offsetMs);
        const attributes: JSONObject = {
          ...resourceAttributes,
          ...logData.attributes,
        };

        return {
          _id: ObjectID.generateTimeOrdered().toString(),
          createdAt: createdAt,
          ...serviceColumns,
          time: OneUptimeDate.toClickhouseDateTime64(loggedAt),
          timeUnixNano: toUnixNanoText(loggedAt),
          severityNumber: LogSeverityNumber[logData.severity],
          severityText: logData.severity,
          attributes: attributes,
          attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
          traceId: traceId,
          spanId: rootSpanId,
          sessionId: "",
          body: logData.body,
          observedTimeUnixNano: toUnixNanoText(loggedAt),
          droppedAttributesCount: 0,
          flags: 0,
          retentionDate: retentionDate,
        };
      };

      const cartItems: number = 1 + Math.floor(random() * 5);

      rows.logs.push(
        log({
          offsetMs: 1,
          severity: LogSeverity.Information,
          body: `Checkout started for a cart of ${cartItems} items`,
          attributes: { "cart.items": cartItems },
        }),
      );

      if (isSlow) {
        rows.logs.push(
          log({
            offsetMs: 5 + queryMs,
            severity: LogSeverity.Warning,
            body: `Slow query: SELECT orders took ${queryMs} ms (discount lookup)`,
            attributes: { "db.duration_ms": queryMs },
          }),
        );
      }

      rows.logs.push(
        isError
          ? log({
              offsetMs: totalMs,
              severity: LogSeverity.Error,
              body: "Payment failed: the payment provider did not answer in 5 seconds",
              attributes: { "http.response.status_code": 502 },
            })
          : log({
              offsetMs: totalMs,
              severity: LogSeverity.Information,
              body: `Order placed in ${totalMs} ms`,
              attributes: { "http.response.status_code": 200 },
            }),
      );
    }

    // METRICS: one point a minute in the last hour, every 15 minutes before.
    const metric: (metricData: {
      name: string;
      at: Date;
      value: number;
      primaryEntityColumns: JSONObject;
      attributes: JSONObject;
    }) => JSONObject = (metricData: {
      name: string;
      at: Date;
      value: number;
      primaryEntityColumns: JSONObject;
      attributes: JSONObject;
    }): JSONObject => {
      const time: string = OneUptimeDate.toClickhouseDateTime(metricData.at);

      return {
        _id: ObjectID.generateTimeOrdered().toString(),
        createdAt: createdAt,
        ...metricData.primaryEntityColumns,
        name: metricData.name,
        aggregationTemporality: null,
        metricPointType: MetricPointType.Gauge,
        time: time,
        startTime: null,
        timeUnixNano: toUnixNanoText(metricData.at),
        startTimeUnixNano: null,
        attributes: metricData.attributes,
        attributeKeys: TelemetryUtil.getAttributeKeys(metricData.attributes),
        isMonotonic: null,
        count: null,
        sum: null,
        min: null,
        max: null,
        bucketCounts: [],
        explicitBounds: [],
        value: metricData.value,
        retentionDate: retentionDate,
      };
    };

    for (const minutesAgo of SampleProjectTelemetry.getTraceMinutesAgo()) {
      const at: Date = minutesBefore(data.now, minutesAgo);
      const isSlow: boolean = isSlowAt(minutesAgo);
      const jitter: () => number = (): number => {
        return 0.9 + random() * 0.2;
      };

      const valueOf: Record<string, number> = {
        [MetricDashboardMetricType.HttpRequestCount]: Math.round(42 * jitter()),
        [MetricDashboardMetricType.HttpRequestDuration]: Math.round(
          (isSlow ? 820 : 310) * jitter(),
        ),
        [MetricDashboardMetricType.HttpRequestErrorRate]:
          Math.round((isSlow ? 2.6 : 0.2) * jitter() * 100) / 100,
        [MetricDashboardMetricType.HttpActiveRequests]: Math.round(
          (isSlow ? 19 : 6) * jitter(),
        ),
        [MetricDashboardMetricType.HttpResponseSize]: Math.round(
          1840 * jitter(),
        ),
        [MetricDashboardMetricType.SystemCpuUtilization]:
          Math.round((isSlow ? 0.71 : 0.34) * jitter() * 1000) / 1000,
        [MetricDashboardMetricType.SystemMemoryUsage]: Math.round(
          1_610_612_736 * jitter(),
        ),
      };

      for (const serviceMetric of SAMPLE_SERVICE_METRICS) {
        rows.metrics.push(
          metric({
            name: serviceMetric.name,
            at: at,
            value: valueOf[serviceMetric.name] || 0,
            primaryEntityColumns: serviceColumns,
            attributes: {
              ...resourceAttributes,
              "http.route": "/checkout",
            },
          }),
        );
      }

      // The web monitors' response times, over the same day.
      for (const monitor of data.monitors) {
        const isSlowMonitor: boolean = monitor.isSlowNow && isSlow;

        rows.metrics.push(
          metric({
            name: MonitorMetricType.ResponseTime,
            at: at,
            value: Math.round(
              monitor.baseResponseTimeInMs * (isSlowMonitor ? 6 : 1) * jitter(),
            ),
            primaryEntityColumns: {
              projectId: projectId,
              primaryEntityId: monitor.monitorId.toString(),
              primaryEntityType: ServiceType.Monitor,
            },
            attributes: {
              monitorId: monitor.monitorId.toString(),
              projectId: projectId,
              monitorName: monitor.name,
            },
          }),
        );
      }
    }

    return rows;
  }

  /*
   * Writes the rows, and waits until the analytics database has them: the
   * person is sent to the sample right after, and its pages read them.
   */
  public static async write(rows: SampleTelemetryRows): Promise<void> {
    const options: { clickhouseSettings: JSONObject } = {
      clickhouseSettings: { wait_for_async_insert: 1 },
    };

    await Promise.all([
      rows.logs.length > 0
        ? LogService.insertJsonRows(rows.logs, options as never)
        : Promise.resolve(),
      rows.spans.length > 0
        ? SpanService.insertJsonRows(rows.spans, options as never)
        : Promise.resolve(),
      rows.metrics.length > 0
        ? MetricService.insertJsonRows(rows.metrics, options as never)
        : Promise.resolve(),
    ]);
  }
}
