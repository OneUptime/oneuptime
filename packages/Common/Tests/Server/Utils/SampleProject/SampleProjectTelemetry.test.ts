import { TelemetryServiceMetadata } from "../../../../Server/Services/OpenTelemetryIngestService";
import LogService from "../../../../Server/Services/LogService";
import MetricService from "../../../../Server/Services/MetricService";
import SpanService from "../../../../Server/Services/SpanService";
import SampleProjectTelemetry, {
  SAMPLE_DENSE_MINUTES,
  SAMPLE_SERVICE_METRICS,
  SAMPLE_SLOWDOWN_STARTED_MINUTES_AGO,
  SampleTelemetryRows,
  createSeededRandom,
} from "../../../../Server/Utils/SampleProject/SampleProjectTelemetry";
import { SpanKind, SpanStatus } from "../../../../Models/AnalyticsModels/Span";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import LogSeverity from "../../../../Types/Log/LogSeverity";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import ObjectID from "../../../../Types/ObjectID";
import { SAMPLE_PROJECT_TELEMETRY_RETENTION_IN_DAYS } from "../../../../Types/SampleProject/SampleProject";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * THE SAMPLE'S TELEMETRY (issue #6808): a few thousand rows written once,
 * that tell the sample's story - checkout-api slows down 27 minutes before
 * the sample is made - dense in the hour the Logs, Traces and Metrics pages
 * open on, kept as long as the sample lives, and the same for the same
 * seed.
 */

const NOW: Date = new Date("2026-11-12T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "5a3c0000-0000-4000-8000-0000000000a1",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "5a3c0000-0000-4000-8000-0000000000e1",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "5a3c0000-0000-4000-8000-0000000000f1",
);
const SLOW_MONITOR_ID: ObjectID = new ObjectID(
  "5a3c0000-0000-4000-8000-0000000000f2",
);

const service: TelemetryServiceMetadata = {
  serviceName: "checkout-api",
  primaryEntityId: SERVICE_ID,
  primaryEntityType: ServiceType.OpenTelemetry,
  entityKeys: ["service-key"],
} as TelemetryServiceMetadata;

const build: (seed?: number) => SampleTelemetryRows = (
  seed?: number,
): SampleTelemetryRows => {
  return SampleProjectTelemetry.buildRows({
    projectId: PROJECT_ID,
    service: service,
    monitors: [
      {
        monitorId: MONITOR_ID,
        name: "Storefront",
        baseResponseTimeInMs: 240,
        isSlowNow: false,
      },
      {
        monitorId: SLOW_MONITOR_ID,
        name: "Checkout",
        baseResponseTimeInMs: 320,
        isSlowNow: true,
      },
    ],
    now: NOW,
    seed: seed,
  });
};

const rows: SampleTelemetryRows = build();

const minutesAgoOf: (clickhouseTime: string) => number = (
  clickhouseTime: string,
): number => {
  const at: Date = new Date(
    `${clickhouseTime.slice(0, 19).replace(" ", "T")}Z`,
  );
  return (NOW.getTime() - at.getTime()) / 60_000;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("how much", () => {
  test("a few thousand rows: enough for a trace and a log search, small enough to cost nothing", () => {
    const total: number =
      rows.logs.length + rows.spans.length + rows.metrics.length;

    expect(total).toBeGreaterThanOrEqual(1500);
    expect(total).toBeLessThanOrEqual(5000);
    expect(rows.logs.length).toBeGreaterThan(100);
    expect(rows.spans.length).toBeGreaterThan(100);
    expect(rows.metrics.length).toBeGreaterThan(100);
  });

  test("a trace a minute in the last hour, sparser before it, a day in all", () => {
    const minutes: Array<number> = SampleProjectTelemetry.getTraceMinutesAgo();

    expect(minutes.slice(0, SAMPLE_DENSE_MINUTES)).toEqual(
      Array.from({ length: SAMPLE_DENSE_MINUTES }, (_v: unknown, i: number) => {
        return i + 1;
      }),
    );
    expect(Math.max(...minutes)).toBeLessThanOrEqual(24 * 60);
  });
});

describe("every row", () => {
  test("is the sample's, kept as long as the sample lives, and written once now", () => {
    const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(
        NOW,
        SAMPLE_PROJECT_TELEMETRY_RETENTION_IN_DAYS,
      ),
    );

    for (const row of [...rows.logs, ...rows.spans, ...rows.metrics]) {
      expect(row["projectId"]).toBe(PROJECT_ID.toString());
      expect(row["retentionDate"]).toBe(retentionDate);
      expect(row["createdAt"]).toBe(OneUptimeDate.toClickhouseDateTime(NOW));
      expect(typeof row["_id"]).toBe("string");
    }
  });

  test("is in the day before the sample was made, never after it", () => {
    for (const span of rows.spans) {
      expect(minutesAgoOf(span["startTime"] as string)).toBeGreaterThan(-1);
      expect(minutesAgoOf(span["startTime"] as string)).toBeLessThanOrEqual(
        24 * 60 + 1,
      );
    }

    for (const metric of rows.metrics) {
      expect(minutesAgoOf(metric["time"] as string)).toBeGreaterThan(0);
    }
  });

  test("of the service names it, its resource and its keys", () => {
    for (const row of [...rows.logs, ...rows.spans]) {
      expect(row["primaryEntityId"]).toBe(SERVICE_ID.toString());
      expect(row["primaryEntityType"]).toBe(ServiceType.OpenTelemetry);
      expect(row["entityKeys"]).toEqual(["service-key"]);
      expect((row["attributes"] as JSONObject)["resource.service.name"]).toBe(
        "checkout-api",
      );
    }
  });
});

describe("the traces", () => {
  const traces: Map<string, Array<JSONObject>> = new Map();

  for (const span of rows.spans) {
    const traceId: string = span["traceId"] as string;
    traces.set(traceId, [...(traces.get(traceId) || []), span]);
  }

  test("each has one root, an entry span the Traces page lists, and children under it", () => {
    expect(traces.size).toBe(
      SampleProjectTelemetry.getTraceMinutesAgo().length,
    );

    for (const spans of traces.values()) {
      const roots: Array<JSONObject> = spans.filter((span: JSONObject) => {
        return span["parentSpanId"] === "";
      });

      expect(roots).toHaveLength(1);
      expect(roots[0]!["isRootSpan"]).toBe(true);
      expect(roots[0]!["isEntrySpan"]).toBe(true);
      expect(roots[0]!["kind"]).toBe(SpanKind.Server);
      expect(roots[0]!["name"]).toBe("POST /checkout");

      for (const child of spans) {
        if (child !== roots[0]) {
          expect(child["parentSpanId"]).toBe(roots[0]!["spanId"]);
          expect(child["isEntrySpan"]).toBe(false);
        }
      }
    }
  });

  test("checkout was fast until it slowed down, and failed only after", () => {
    for (const spans of traces.values()) {
      const root: JSONObject = spans.find((span: JSONObject) => {
        return span["parentSpanId"] === "";
      })!;
      const minutesAgo: number = minutesAgoOf(root["startTime"] as string);
      const durationMs: number = Number(
        BigInt(root["durationUnixNano"] as string) / BigInt(1_000_000),
      );

      if (minutesAgo > SAMPLE_SLOWDOWN_STARTED_MINUTES_AGO + 1) {
        expect(durationMs).toBeLessThan(600);
        expect(root["statusCode"]).toBe(SpanStatus.Ok);
      }
    }

    const slowOrFailed: Array<JSONObject> = rows.spans.filter(
      (span: JSONObject) => {
        return (
          span["parentSpanId"] === "" &&
          Number(
            BigInt(span["durationUnixNano"] as string) / BigInt(1_000_000),
          ) > 1000
        );
      },
    );

    expect(slowOrFailed.length).toBeGreaterThan(0);
  });

  test("a span's duration is its end less its start", () => {
    for (const span of rows.spans) {
      expect(
        BigInt(span["endTimeUnixNano"] as string) -
          BigInt(span["startTimeUnixNano"] as string),
      ).toBe(BigInt(span["durationUnixNano"] as string));
    }
  });
});

describe("the logs", () => {
  test("each belongs to a trace, at a severity the Logs page knows", () => {
    const traceIds: Set<string> = new Set<string>(
      rows.spans.map((span: JSONObject) => {
        return span["traceId"] as string;
      }),
    );

    for (const log of rows.logs) {
      expect(traceIds).toContain(log["traceId"]);
      expect(Object.values(LogSeverity)).toContain(log["severityText"]);
    }
  });

  test("the slowdown shows in them: slow queries, and failed payments only after it", () => {
    const warnings: Array<JSONObject> = rows.logs.filter((log: JSONObject) => {
      return log["severityText"] === LogSeverity.Warning;
    });

    expect(warnings.length).toBeGreaterThan(0);

    for (const log of rows.logs) {
      if (
        log["severityText"] === LogSeverity.Error ||
        log["severityText"] === LogSeverity.Warning
      ) {
        expect(minutesAgoOf(log["time"] as string)).toBeLessThanOrEqual(
          SAMPLE_SLOWDOWN_STARTED_MINUTES_AGO + 1,
        );
      }
    }
  });
});

describe("the metrics", () => {
  test("the service's, by the names the Metrics dashboard charts, and the monitors' response times", () => {
    const names: Set<string> = new Set<string>(
      rows.metrics.map((metric: JSONObject) => {
        return metric["name"] as string;
      }),
    );

    for (const metric of SAMPLE_SERVICE_METRICS) {
      expect(names).toContain(metric.name);
    }

    expect(names).toContain(MonitorMetricType.ResponseTime);
    expect(names.size).toBe(SAMPLE_SERVICE_METRICS.length + 1);
  });

  test("a monitor's response time is the monitor's, and the slow one slowed down", () => {
    const responseTimes: Array<JSONObject> = rows.metrics.filter(
      (metric: JSONObject) => {
        return metric["name"] === MonitorMetricType.ResponseTime;
      },
    );

    for (const metric of responseTimes) {
      expect(metric["primaryEntityType"]).toBe(ServiceType.Monitor);
      expect((metric["attributes"] as JSONObject)["monitorId"]).toBe(
        metric["primaryEntityId"],
      );
    }

    const lastOf: (monitorId: ObjectID) => number = (
      monitorId: ObjectID,
    ): number => {
      return responseTimes
        .filter((metric: JSONObject) => {
          return metric["primaryEntityId"] === monitorId.toString();
        })
        .filter((metric: JSONObject) => {
          return minutesAgoOf(metric["time"] as string) <= 5;
        })
        .map((metric: JSONObject) => {
          return metric["value"] as number;
        })
        .reduce((a: number, b: number) => {
          return Math.max(a, b);
        }, 0);
    };

    expect(lastOf(SLOW_MONITOR_ID)).toBeGreaterThan(1000);
    expect(lastOf(MONITOR_ID)).toBeLessThan(400);
  });
});

describe("the same seed, the same story", () => {
  test("values repeat, ids do not", () => {
    const again: SampleTelemetryRows = build();

    expect(
      again.spans.map((span: JSONObject) => {
        return span["durationUnixNano"];
      }),
    ).toEqual(
      rows.spans.map((span: JSONObject) => {
        return span["durationUnixNano"];
      }),
    );
    expect(again.spans[0]!["_id"]).not.toBe(rows.spans[0]!["_id"]);
  });

  test("another seed tells it differently", () => {
    expect(
      build(42).spans.map((span: JSONObject) => {
        return span["traceId"];
      }),
    ).not.toEqual(
      rows.spans.map((span: JSONObject) => {
        return span["traceId"];
      }),
    );
  });

  test("the generator is between 0 and 1", () => {
    const random: () => number = createSeededRandom(1);

    for (let i: number = 0; i < 1000; i++) {
      const value: number = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("writing", () => {
  test("each kind goes to its own table, waiting until it is there", async () => {
    const logs: jest.SpyInstance = jest
      .spyOn(LogService, "insertJsonRows")
      .mockResolvedValue(undefined as never);
    const spans: jest.SpyInstance = jest
      .spyOn(SpanService, "insertJsonRows")
      .mockResolvedValue(undefined as never);
    const metrics: jest.SpyInstance = jest
      .spyOn(MetricService, "insertJsonRows")
      .mockResolvedValue(undefined as never);

    await SampleProjectTelemetry.write(rows);

    const waits: { clickhouseSettings: JSONObject } = {
      clickhouseSettings: { wait_for_async_insert: 1 },
    };

    expect(logs).toHaveBeenCalledWith(rows.logs, waits);
    expect(spans).toHaveBeenCalledWith(rows.spans, waits);
    expect(metrics).toHaveBeenCalledWith(rows.metrics, waits);
  });
});
