import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The telemetry usage sweep (issue #6355): each finished five-minute bucket
 * of the usage counters the telemetry worker keeps becomes
 * oneuptime.telemetry.usage.bytes points, each its resource's, for the
 * projects that publish their usage as metrics - and is forgotten once
 * written. Every store is mocked at its module boundary: the counters are
 * tested against a real Valkey on their own.
 */

jest.mock(
  "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionCounter",
  () => {
    const actual: { default: Record<string, unknown> } = jest.requireActual(
      "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionCounter",
    ) as { default: Record<string, unknown> };

    return {
      __esModule: true,
      ...actual,
      default: {
        getUsageBucketId: (
          actual.default["getUsageBucketId"] as (nowMs: number) => string
        ).bind(actual.default),
        getUsageBucketStart: (
          actual.default["getUsageBucketStart"] as (bucket: string) => Date
        ).bind(actual.default),
        listUsageProjects: jest.fn(),
        readUsage: jest.fn(),
        deleteUsage: jest.fn(),
      },
    };
  },
);

jest.mock(
  "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionSettings",
  () => {
    return {
      __esModule: true,
      default: { getUsageMetricProjects: jest.fn() },
    };
  },
);

jest.mock("../../../../Server/Services/MetricService", () => {
  return { __esModule: true, default: { insertJsonRows: jest.fn() } };
});
jest.mock("../../../../Server/Services/GlobalConfigService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});
jest.mock("../../../../Server/Utils/Telemetry/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      indexMetricNameServiceNameMap: jest.fn(),
      getAttributeKeys: (
        attributes: Record<string, unknown>,
      ): Array<string> => {
        return Object.keys(attributes);
      },
      getAttributesForServiceIdAndServiceName: (data: {
        serviceId: { toString: () => string };
        serviceName: string;
      }): Record<string, string> => {
        return {
          "oneuptime.service.id": data.serviceId.toString(),
          "oneuptime.service.name": data.serviceName,
        };
      },
    },
  };
});
jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import TelemetryUsageMetrics, {
  TelemetryUsageSweepSummary,
} from "../../../../Server/Utils/Telemetry/TelemetryUsageMetrics";
import TelemetryIngestAttributionCounter, {
  TelemetryUsageCounterEntry,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionCounter";
import TelemetryIngestAttributionSettings from "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionSettings";
import MetricService from "../../../../Server/Services/MetricService";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import {
  AggregationTemporality,
  MetricPointType,
} from "../../../../Models/AnalyticsModels/Metric";
import { JSONObject } from "../../../../Types/JSON";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import TelemetryUsageMetricType from "../../../../Types/Telemetry/TelemetryUsageMetricType";

type MockFn = jest.Mock;

const PROJECT_ID: string = "c3c3c3c3-0000-4000-8000-000000000001";
const OFF_PROJECT_ID: string = "c3c3c3c3-0000-4000-8000-000000000002";
const SERVICE_ID: string = "c3c3c3c3-0000-4000-8000-000000000003";
const HOST_ID: string = "c3c3c3c3-0000-4000-8000-000000000004";
const NOW: Date = new Date("2026-11-09T12:07:00Z");

const listUsageProjects: MockFn =
  TelemetryIngestAttributionCounter.listUsageProjects as unknown as MockFn;
const readUsage: MockFn =
  TelemetryIngestAttributionCounter.readUsage as unknown as MockFn;
const deleteUsage: MockFn =
  TelemetryIngestAttributionCounter.deleteUsage as unknown as MockFn;
const insertJsonRows: MockFn =
  MetricService.insertJsonRows as unknown as MockFn;

const entry: (
  data: Partial<TelemetryUsageCounterEntry>,
) => TelemetryUsageCounterEntry = (
  data: Partial<TelemetryUsageCounterEntry>,
): TelemetryUsageCounterEntry => {
  return {
    signalSlug: "logs",
    resourceType: ServiceType.OpenTelemetry,
    resourceId: SERVICE_ID,
    resourceName: "checkout",
    bytes: 1000,
    ...data,
  };
};

// The bucket before the one NOW is in: 12:00 to 12:05.
const LAST_BUCKET: string = String(
  Math.floor(Date.parse("2026-11-09T12:00:00Z") / (5 * 60 * 1000)),
);

beforeEach(() => {
  jest.clearAllMocks();
  listUsageProjects.mockImplementation((async (bucket: string) => {
    return bucket === LAST_BUCKET ? [PROJECT_ID, OFF_PROJECT_ID] : [];
  }) as never);
  readUsage.mockImplementation((async (
    _bucket: string,
    projectIds: Array<string>,
  ) => {
    return new Map(
      projectIds.map((projectId: string) => {
        return [
          projectId,
          [
            entry({}),
            entry({
              resourceType: ServiceType.Host,
              resourceId: HOST_ID,
              resourceName: "web-1",
              signalSlug: "metrics",
              bytes: 50,
            }),
          ],
        ];
      }),
    );
  }) as never);
  deleteUsage.mockResolvedValue(undefined as never);
  (
    TelemetryIngestAttributionSettings.getUsageMetricProjects as unknown as MockFn
  ).mockResolvedValue(new Set([PROJECT_ID]) as never);
  (GlobalConfigService.findOneById as unknown as MockFn).mockResolvedValue({
    monitorMetricRetentionInDays: 14,
  } as never);
  insertJsonRows.mockResolvedValue(undefined as never);
  (
    TelemetryUtil.indexMetricNameServiceNameMap as unknown as MockFn
  ).mockResolvedValue(undefined as never);
});

describe("the buckets a sweep reads", () => {
  test("every finished bucket the counters may still hold, oldest first, never the current one", () => {
    const buckets: Array<string> =
      TelemetryUsageMetrics.getFinishedBucketIds(NOW);

    // An hour of five-minute buckets.
    expect(buckets).toHaveLength(12);
    expect(buckets[buckets.length - 1]).toBe(LAST_BUCKET);
    expect(Number(buckets[0])).toBe(Number(LAST_BUCKET) - 11);
  });
});

describe("buildRows", () => {
  const rows: () => Array<JSONObject> = (): Array<JSONObject> => {
    return TelemetryUsageMetrics.buildRows({
      projectId: PROJECT_ID,
      entries: [
        entry({}),
        entry({
          resourceType: ServiceType.Host,
          resourceId: HOST_ID,
          resourceName: "web-1",
          signalSlug: "metrics",
          bytes: 50,
        }),
        // Telemetry that named no resource: the project's own.
        entry({
          resourceType: ServiceType.Unknown,
          resourceId: PROJECT_ID,
          resourceName: "",
          bytes: 7,
        }),
        // Nothing sent: no point.
        entry({ bytes: 0 }),
      ],
      bucketStart: new Date("2026-11-09T12:00:00Z"),
      retentionDate: new Date("2026-11-23T12:00:00Z"),
    });
  };

  test("one Sum point of each resource's bytes in the bucket, Delta, keyed to the resource", () => {
    const [service, host, unknown] = rows() as [
      JSONObject,
      JSONObject,
      JSONObject,
    ];

    expect(rows()).toHaveLength(3);
    expect(service["name"]).toBe(TelemetryUsageMetricType.UsageBytes);
    expect(service["value"]).toBe(1000);
    expect(service["metricPointType"]).toBe(MetricPointType.Sum);
    expect(service["aggregationTemporality"]).toBe(
      AggregationTemporality.Delta,
    );
    expect(service["projectId"]).toBe(PROJECT_ID);
    // Keyed to the service: read as its telemetry is, charted on its page.
    expect(service["primaryEntityId"]).toBe(SERVICE_ID);
    expect(service["primaryEntityType"]).toBe(ServiceType.OpenTelemetry);
    expect(String(service["time"])).toContain("2026-11-09 12:00:00");
    expect(host["primaryEntityId"]).toBe(HOST_ID);
    expect(host["primaryEntityType"]).toBe(ServiceType.Host);
    expect(unknown["primaryEntityId"]).toBe(PROJECT_ID);
    expect(unknown["primaryEntityType"]).toBe(ServiceType.Unknown);
  });

  test("carries the attributes the docs list, and a service's own stamps", () => {
    const [service, host, unknown] = rows() as [
      JSONObject,
      JSONObject,
      JSONObject,
    ];

    expect(service["attributes"]).toEqual({
      projectId: PROJECT_ID,
      signal: "logs",
      resourceType: ServiceType.OpenTelemetry,
      resourceId: SERVICE_ID,
      resourceName: "checkout",
      "oneuptime.service.id": SERVICE_ID,
      "oneuptime.service.name": "checkout",
    });
    expect(host["attributes"]).toEqual({
      projectId: PROJECT_ID,
      signal: "metrics",
      resourceType: ServiceType.Host,
      resourceId: HOST_ID,
      resourceName: "web-1",
    });
    // No name to give: none given.
    expect(
      Object.keys(unknown["attributes"] as JSONObject).includes("resourceName"),
    ).toBe(false);
  });
});

describe("publishAll", () => {
  test("writes the publishing projects' points in one insert, forgets the bucket, and registers the name", async () => {
    const summary: TelemetryUsageSweepSummary =
      await TelemetryUsageMetrics.publishAll({ now: NOW });

    expect(summary.stopReason).toBe("done");
    expect(summary.bucketsRead).toBe(1);
    expect(summary.projectsScanned).toBe(2);
    expect(insertJsonRows).toHaveBeenCalledTimes(1);

    const rows: Array<JSONObject> = insertJsonRows.mock
      .calls[0]![0] as Array<JSONObject>;

    // The project that turned it off since it was counted writes nothing.
    expect(
      rows.map((row: JSONObject) => {
        return row["projectId"];
      }),
    ).toEqual([PROJECT_ID, PROJECT_ID]);
    expect(summary.rowsWritten).toBe(2);
    // Kept as long as monitor metrics.
    expect(String(rows[0]!["retentionDate"])).toContain("2026-11-23");

    // Both projects' counts are forgotten: written, or not to be written.
    expect(deleteUsage).toHaveBeenCalledWith(LAST_BUCKET, [
      PROJECT_ID,
      OFF_PROJECT_ID,
    ]);
    expect(TelemetryUtil.indexMetricNameServiceNameMap).toHaveBeenCalledTimes(
      1,
    );
  });

  test("stops, writing and forgetting nothing, when the counters cannot be read", async () => {
    listUsageProjects.mockResolvedValue(null as never);

    const summary: TelemetryUsageSweepSummary =
      await TelemetryUsageMetrics.publishAll({ now: NOW });

    expect(summary.stopReason).toBe("counters-unavailable");
    expect(insertJsonRows).not.toHaveBeenCalled();
    expect(deleteUsage).not.toHaveBeenCalled();
  });

  test("keeps a bucket it could not write, for the next sweep to try again", async () => {
    insertJsonRows.mockRejectedValue(new Error("ClickHouse is down") as never);

    const summary: TelemetryUsageSweepSummary =
      await TelemetryUsageMetrics.publishAll({ now: NOW });

    expect(summary.pagesFailed).toBe(1);
    expect(deleteUsage).not.toHaveBeenCalled();
  });

  test("stops between pages once its run is over", async () => {
    const summary: TelemetryUsageSweepSummary =
      await TelemetryUsageMetrics.publishAll({
        now: NOW,
        shouldContinue: () => {
          return false;
        },
      });

    expect(summary.stopReason).toBe("lock-lost");
    expect(insertJsonRows).not.toHaveBeenCalled();
  });
});
