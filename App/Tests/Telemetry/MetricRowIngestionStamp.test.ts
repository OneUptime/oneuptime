/*
 * These tests exercise the pure row-building statics only — nothing here
 * touches Postgres. Stub the DatabaseService base class out before the
 * metrics service's import graph drags the whole server-side service layer
 * (and its ts-jest compile surface) into the suite.
 */
jest.mock("Common/Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class DatabaseServiceStub {},
  };
});

import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { MetricPointType } from "Common/Models/AnalyticsModels/Metric";
import OneUptimeDate from "Common/Types/Date";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Contract under test — the wall-clock stamps on metric rows after the
 * per-datapoint date derivation was replaced by the shared per-second
 * ingestion-stamp memo.
 *
 * buildMetricRow used to call getCurrentDate + toClickhouseDateTime (and
 * addRemoveDays + a second format for retention) for EVERY datapoint. It now
 * reads the memoized stamp. The rows it emits must be indistinguishable from
 * before: createdAt = ingest wall clock at second precision, retentionDate =
 * createdAt + retentionDays, time fields still derived from the datapoint's
 * own timeUnixNano. The same-second identity test pins the memo actually
 * being used (mutation guard: reverting to per-row derivation with
 * sub-second jitter would still pass equality-of-format, so we assert
 * against the reference derivation from the frozen clock instead).
 */

/*
 * Minimal structural view of a jest spy — the @jest/globals and @types/jest
 * spy types disagree in this repo, so annotate with just the surface this
 * test reads.
 */
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
};

type BuildMetricRowFn = (data: {
  datapoint: JSONObject;
  baseAttributes: JSONObject;
  projectId: ObjectID;
  primaryEntityId: ObjectID;
  serviceName: string;
  metricName: string;
  metricPointType: MetricPointType;
  serviceMetadata: TelemetryServiceMetadata;
}) => JSONObject;

const buildMetricRow: BuildMetricRowFn = (
  OtelMetricsIngestService as unknown as {
    buildMetricRow: BuildMetricRowFn;
  }
).buildMetricRow.bind(OtelMetricsIngestService);

type SafeParseUnixNanoFn = (
  value: string | number | undefined,
  context: string,
) => JSONObject;

const safeParseUnixNano: SafeParseUnixNanoFn = (
  OtelMetricsIngestService as unknown as {
    safeParseUnixNano: SafeParseUnixNanoFn;
  }
).safeParseUnixNano.bind(OtelMetricsIngestService);

const PROJECT_ID: ObjectID = ObjectID.generate();
const ENTITY_ID: ObjectID = ObjectID.generate();

function serviceMetadata(retentionDays?: number): TelemetryServiceMetadata {
  return {
    serviceName: "test-service",
    primaryEntityId: ENTITY_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    serviceRetentionInDays: retentionDays,
  } as TelemetryServiceMetadata;
}

function buildRow(data?: {
  retentionDays?: number;
  timeUnixNano?: string;
}): JSONObject {
  return buildMetricRow({
    datapoint: {
      timeUnixNano: data?.timeUnixNano ?? `${Date.now()}000000`,
      asInt: 1,
      attributes: [],
    },
    baseAttributes: { "service.name": "test-service" },
    projectId: PROJECT_ID,
    primaryEntityId: ENTITY_ID,
    serviceName: "test-service",
    metricName: "test_metric",
    metricPointType: MetricPointType.Gauge,
    serviceMetadata: serviceMetadata(data?.retentionDays),
  });
}

describe("buildMetricRow ingestion stamps", () => {
  beforeEach(() => {
    /*
     * Fake Date only. The OpenTelemetry SDK in this suite's import graph
     * pins global.performance as read-only, so sinon's default install
     * (which also hijacks performance/hrtime/timers) throws.
     */
    jest.useFakeTimers({
      doNotFake: [
        "hrtime",
        "nextTick",
        "performance",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
    });
    jest.setSystemTime(new Date("2026-08-10T14:30:45.678Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("createdAt is the ingest wall clock at second precision", () => {
    const row: JSONObject = buildRow();

    expect(row["createdAt"]).toBe("2026-08-10 14:30:45");
  });

  test("retentionDate = createdAt + serviceRetentionInDays", () => {
    const row: JSONObject = buildRow({ retentionDays: 30 });

    expect(row["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(new Date("2026-08-10T14:30:45.000Z"), 30),
      ),
    );
  });

  test("retentionDate uses the 15-day hardcoded default when nothing configures it", () => {
    const row: JSONObject = buildRow();

    expect(row["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(new Date("2026-08-10T14:30:45.000Z"), 15),
      ),
    );
  });

  test("rows built in the same second carry identical stamps", () => {
    const first: JSONObject = buildRow({ retentionDays: 30 });
    jest.setSystemTime(new Date("2026-08-10T14:30:45.999Z"));
    const second: JSONObject = buildRow({ retentionDays: 30 });

    expect(second["createdAt"]).toBe(first["createdAt"]);
    expect(second["retentionDate"]).toBe(first["retentionDate"]);
  });

  test("stamps roll over across a second boundary", () => {
    const first: JSONObject = buildRow();
    jest.setSystemTime(new Date("2026-08-10T14:30:46.001Z"));
    const second: JSONObject = buildRow();

    expect(first["createdAt"]).toBe("2026-08-10 14:30:45");
    expect(second["createdAt"]).toBe("2026-08-10 14:30:46");
  });

  test("distinct retention windows in the same second produce distinct dates", () => {
    const short: JSONObject = buildRow({ retentionDays: 1 });
    const long: JSONObject = buildRow({ retentionDays: 90 });

    /*
     * Derive expectations from the same addRemoveDays the row builder always
     * used — it adds CALENDAR days in the process's local timezone, so a
     * window that crosses a DST boundary is deliberately not a flat
     * days*24h offset. The memo must preserve that behavior exactly.
     */
    const stampDate: Date = new Date("2026-08-10T14:30:45.000Z");
    expect(short["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(stampDate, 1),
      ),
    );
    expect(long["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(stampDate, 90),
      ),
    );
    expect(short["retentionDate"]).not.toBe(long["retentionDate"]);
  });

  test("per-row stamp derivation is gone: a warm memo serves repeated rows", () => {
    // Warm the (second, retention-window) memo before counting calls.
    buildRow({ retentionDays: 30 });

    const getCurrentDateSpy: SpyLike = jest.spyOn(
      OneUptimeDate,
      "getCurrentDate",
    ) as unknown as SpyLike;
    const addRemoveDaysSpy: SpyLike = jest.spyOn(
      OneUptimeDate,
      "addRemoveDays",
    ) as unknown as SpyLike;
    const formatSpy: SpyLike = jest.spyOn(
      OneUptimeDate,
      "toClickhouseDateTime",
    ) as unknown as SpyLike;

    try {
      for (let i: number = 0; i < 50; i++) {
        buildRow({ retentionDays: 30 });
      }

      /*
       * The pre-memo code called getCurrentDate + addRemoveDays (plus two
       * ClickHouse formats) for EVERY datapoint. With a warm memo none of
       * that runs per row — the only per-row format left is the datapoint's
       * own time field. Reverting to per-row derivation trips all three
       * counts; this is the mutation guard the frozen-clock equality tests
       * above cannot provide.
       */
      expect(getCurrentDateSpy.mock.calls.length).toBe(0);
      expect(addRemoveDaysSpy.mock.calls.length).toBe(0);
      expect(formatSpy.mock.calls.length).toBe(50);
    } finally {
      getCurrentDateSpy.mockRestore();
      addRemoveDaysSpy.mockRestore();
      formatSpy.mockRestore();
    }
  });

  test("time fields still come from the datapoint's own timeUnixNano", () => {
    // 2026-08-10T10:00:00.123456789Z as unix nanos.
    const baseMs: number = Date.UTC(2026, 7, 10, 10, 0, 0, 0);
    const nanoValue: string = `${(baseMs / 1000) * 1_000_000_000 + 123_456_789}`;

    const row: JSONObject = buildRow({ timeUnixNano: nanoValue });

    expect(row["time"]).toBe("2026-08-10 10:00:00");
    expect(row["timeUnixNano"]).toBe(nanoValue);
  });
});

describe("safeParseUnixNano after the unused iso removal", () => {
  test("returns nano/db/date and no iso field", () => {
    const ms: number = Date.UTC(2026, 7, 10, 10, 0, 0, 0);
    const nano: number = ms * 1_000_000;

    const parsed: JSONObject = safeParseUnixNano(nano, "test");

    expect(parsed["nano"]).toBe(String(nano));
    expect(parsed["db"]).toBe("2026-08-10 10:00:00");
    expect(parsed["date"]).toBeInstanceOf(Date);
    expect((parsed["date"] as Date).getTime()).toBe(ms);
    expect(Object.prototype.hasOwnProperty.call(parsed, "iso")).toBe(false);
  });

  test("db string matches the shared ClickHouse formatter", () => {
    const ms: number = Date.UTC(2025, 0, 15, 23, 59, 59, 500);
    const parsed: JSONObject = safeParseUnixNano(ms * 1_000_000, "test");

    expect(parsed["db"]).toBe(OneUptimeDate.toClickhouseDateTime(new Date(ms)));
  });
});
