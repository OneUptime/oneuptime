import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import {
  PRODUCT_ANALYTICS_DERIVED_METRICS,
  PRODUCT_ANALYTICS_DERIVED_METRIC_INTERVAL_MS,
  PRODUCT_ANALYTICS_DEVICE_TYPE_ATTRIBUTE,
  PRODUCT_ANALYTICS_EVENT_NAME_ATTRIBUTE,
  ProductAnalyticsDerivedMetric,
  ProductAnalyticsEventKind,
  ProductAnalyticsParsedEvent,
} from "Common/Types/Rum/ProductAnalyticsEvents";

/*
 * ProductAnalyticsDerivedMetrics (issue #6444, part two): the per-minute
 * series an application's events feed into the metric store - track()
 * events by event.name, sessions and page views by device.type - so they
 * can be charted, put on a dashboard and alerted on with a Metrics
 * monitor. Counted in memory per minute, written once the minute (and a
 * few seconds of grace) is over, as Delta Sums that add up across workers.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn(),
  };
});

jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (): void => {
        // No-op decorator: the real one needs a live tracer provider.
      };
    },
  };
});

jest.mock("Common/Server/Utils/GracefulShutdown", () => {
  return {
    __esModule: true,
    default: { registerHandler: jest.fn() },
    ShutdownPriority: { Workers: 20 },
  };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { insertJsonRows: jest.fn() },
  };
});

jest.mock("Common/Server/Services/OpenTelemetryIngestService", () => {
  return {
    __esModule: true,
    default: { buildResourceMetadataForNonService: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Telemetry/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      getAttributeKeys: (
        attributes: Record<string, unknown>,
      ): Array<string> => {
        return Object.keys(attributes).sort();
      },
      indexMetricNameServiceNameMap: jest.fn(),
    },
  };
});

import GracefulShutdown from "Common/Server/Utils/GracefulShutdown";
import MetricService from "Common/Server/Services/MetricService";
import OTelIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import ProductAnalyticsDerivedMetrics, {
  PRODUCT_ANALYTICS_DERIVED_GRACE_MS,
  PRODUCT_ANALYTICS_DERIVED_MAX_BUCKETS,
  ProductAnalyticsDerivedBucket,
} from "../../FeatureSet/Telemetry/Utils/ProductAnalyticsDerivedMetrics";
import { ProductAnalyticsEventsJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

type MockedFn = ReturnType<typeof jest.fn>;

const insertMock: MockedFn =
  MetricService.insertJsonRows as unknown as MockedFn;
const metadataMock: MockedFn =
  OTelIngestService.buildResourceMetadataForNonService as unknown as MockedFn;
const indexMock: MockedFn =
  TelemetryUtil.indexMetricNameServiceNameMap as unknown as MockedFn;
const registerHandlerMock: MockedFn =
  GracefulShutdown.registerHandler as unknown as MockedFn;

const PROJECT_ID: string = ObjectID.generate().toString();
const APP_ID: string = ObjectID.generate().toString();
const OTHER_APP_ID: string = ObjectID.generate().toString();

/* 12:00:00 UTC; every test's events happen in the minutes after it. */
const MINUTE: number = Date.UTC(2026, 10, 10, 12, 0, 0);

function event(
  kind: ProductAnalyticsEventKind,
  name: string,
  time: number,
): ProductAnalyticsParsedEvent {
  return { kind: kind, name: name, time: time, page: "/", properties: {} };
}

function job(
  events: Array<ProductAnalyticsParsedEvent>,
  overrides?: Partial<ProductAnalyticsEventsJobData>,
): ProductAnalyticsEventsJobData {
  return {
    projectId: PROJECT_ID,
    rumApplicationId: APP_ID,
    batchId: "a".repeat(32),
    receivedAtUnixMs: MINUTE,
    countryCode: "",
    sessionId: "b".repeat(32),
    visitorId: "c".repeat(32),
    identifiedUserKey: "",
    userProperties: {},
    context: {
      deviceType: "tablet",
      browserName: "Safari",
      osName: "iPadOS",
      appVersion: "",
    },
    events: events,
    metrics: [],
    ...overrides,
  };
}

function writtenRows(): Array<JSONObject> {
  return insertMock.mock.calls.flatMap((call: Array<unknown>) => {
    return call[0] as Array<JSONObject>;
  });
}

beforeEach(() => {
  ProductAnalyticsDerivedMetrics.resetForTests();
  insertMock.mockReset();
  insertMock.mockImplementation(async (): Promise<void> => {});
  metadataMock.mockReset();
  metadataMock.mockImplementation(async (): Promise<unknown> => {
    return {
      serviceRetentionConfig: null,
      serviceRetentionInDays: 15,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    };
  });
  indexMock.mockReset();
  indexMock.mockImplementation(async (): Promise<void> => {});
});

afterEach(() => {
  ProductAnalyticsDerivedMetrics.resetForTests();
  jest.restoreAllMocks();
});

describe("which series an event counts in", () => {
  test("a track() event counts in the events series under its name", () => {
    expect(
      ProductAnalyticsDerivedMetrics.bucketOf({
        job: job([]),
        event: event(
          ProductAnalyticsEventKind.Custom,
          "Signed up",
          MINUTE + 59_999,
        ),
      }),
    ).toEqual({
      projectId: PROJECT_ID,
      rumApplicationId: APP_ID,
      minuteStartMs: MINUTE,
      metric: ProductAnalyticsDerivedMetric.Events,
      attributeKey: PRODUCT_ANALYTICS_EVENT_NAME_ATTRIBUTE,
      attributeValue: "Signed up",
    });
  });

  test.each([
    [ProductAnalyticsEventKind.Session, ProductAnalyticsDerivedMetric.Sessions],
    [ProductAnalyticsEventKind.Page, ProductAnalyticsDerivedMetric.PageViews],
  ])(
    "a %s event counts in %s under the device type, never its page",
    (
      kind: ProductAnalyticsEventKind,
      metric: ProductAnalyticsDerivedMetric,
    ) => {
      expect(
        ProductAnalyticsDerivedMetrics.bucketOf({
          job: job([]),
          event: event(kind, "/pricing", MINUTE + 60_000),
        }),
      ).toEqual(
        expect.objectContaining({
          minuteStartMs: MINUTE + 60_000,
          metric: metric,
          attributeKey: PRODUCT_ANALYTICS_DEVICE_TYPE_ATTRIBUTE,
          attributeValue: "tablet",
        }),
      );
    },
  );

  test("a session that reported no device type counts as unknown", () => {
    expect(
      ProductAnalyticsDerivedMetrics.bucketOf({
        job: job([], {
          context: {
            deviceType: "",
            browserName: "",
            osName: "",
            appVersion: "",
          },
        }),
        event: event(ProductAnalyticsEventKind.Session, "", MINUTE),
      })?.attributeValue,
    ).toBe("unknown");
  });
});

describe("counting", () => {
  test("events of one series, minute and value add up in one bucket", () => {
    ProductAnalyticsDerivedMetrics.countEvents(
      job([
        event(ProductAnalyticsEventKind.Custom, "Signed up", MINUTE + 1),
        event(ProductAnalyticsEventKind.Custom, "Signed up", MINUTE + 2),
        /* Another name, another minute, another application: three more. */
        event(ProductAnalyticsEventKind.Custom, "Upgraded", MINUTE + 3),
        event(
          ProductAnalyticsEventKind.Custom,
          "Signed up",
          MINUTE + PRODUCT_ANALYTICS_DERIVED_METRIC_INTERVAL_MS,
        ),
      ]),
    );
    ProductAnalyticsDerivedMetrics.countEvents(
      job([event(ProductAnalyticsEventKind.Custom, "Signed up", MINUTE + 4)], {
        rumApplicationId: OTHER_APP_ID,
      }),
    );

    expect(ProductAnalyticsDerivedMetrics.getBucketCountForTests()).toBe(4);

    const due: Array<ProductAnalyticsDerivedBucket> =
      ProductAnalyticsDerivedMetrics.takeDue({
        nowMs: MINUTE,
        everything: true,
      });

    const signedUpThisMinute: ProductAnalyticsDerivedBucket | undefined =
      due.find((bucket: ProductAnalyticsDerivedBucket): boolean => {
        return (
          bucket.rumApplicationId === APP_ID &&
          bucket.attributeValue === "Signed up" &&
          bucket.minuteStartMs === MINUTE
        );
      });

    expect(signedUpThisMinute?.count).toBe(2);
  });
});

describe("when a minute is written", () => {
  test("not before its minute and the grace for late batches are over", () => {
    ProductAnalyticsDerivedMetrics.countEvents(
      job([event(ProductAnalyticsEventKind.Custom, "Signed up", MINUTE)]),
    );

    const endsAt: number =
      MINUTE +
      PRODUCT_ANALYTICS_DERIVED_METRIC_INTERVAL_MS +
      PRODUCT_ANALYTICS_DERIVED_GRACE_MS;

    expect(
      ProductAnalyticsDerivedMetrics.takeDue({
        nowMs: endsAt - 1,
        everything: false,
      }),
    ).toEqual([]);
    expect(
      ProductAnalyticsDerivedMetrics.takeDue({
        nowMs: endsAt,
        everything: false,
      }),
    ).toHaveLength(1);
    /* Taken out: written once. */
    expect(ProductAnalyticsDerivedMetrics.getBucketCountForTests()).toBe(0);
  });

  test("a worker that counted more names than it may hold writes them all at once", async () => {
    const events: Array<ProductAnalyticsParsedEvent> = [];

    for (
      let index: number = 0;
      index < PRODUCT_ANALYTICS_DERIVED_MAX_BUCKETS;
      index++
    ) {
      events.push(
        event(ProductAnalyticsEventKind.Custom, `Event ${index}`, MINUTE),
      );
    }

    jest.spyOn(Date, "now").mockReturnValue(MINUTE);

    ProductAnalyticsDerivedMetrics.countEvents(job(events));

    /* The early write runs in the background; wait for it. */
    await ProductAnalyticsDerivedMetrics.flush({ everything: false });

    expect(ProductAnalyticsDerivedMetrics.getBucketCountForTests()).toBe(0);
    expect(writtenRows()).toHaveLength(PRODUCT_ANALYTICS_DERIVED_MAX_BUCKETS);
  });

  test("a graceful shutdown writes everything", async () => {
    ProductAnalyticsDerivedMetrics.countEvents(
      job([event(ProductAnalyticsEventKind.Custom, "Signed up", MINUTE)]),
    );

    const call: Array<unknown> | undefined =
      registerHandlerMock.mock.calls.find(
        (registered: Array<unknown>): boolean => {
          return registered[0] === "ProductAnalyticsDerivedMetrics";
        },
      );

    expect(call).toBeDefined();

    await (call![2] as () => Promise<void>)();

    expect(writtenRows()).toHaveLength(1);
  });
});

describe("the points", () => {
  test("one Delta Sum point per bucket at its minute, under the RUM application, with the count as its value", () => {
    const rows: Array<JSONObject> = ProductAnalyticsDerivedMetrics.buildRows({
      buckets: [
        {
          projectId: PROJECT_ID,
          rumApplicationId: APP_ID,
          metric: ProductAnalyticsDerivedMetric.Events,
          attributeKey: PRODUCT_ANALYTICS_EVENT_NAME_ATTRIBUTE,
          attributeValue: "Signed up",
          minuteStartMs: MINUTE,
          count: 7,
        },
      ],
      retentionInDaysByApplication: new Map<string, number>([[APP_ID, 15]]),
      writtenAt: new Date(MINUTE + 65_000),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        primaryEntityId: APP_ID,
        primaryEntityType: ServiceType.RealUserMonitor,
        name: "oneuptime.rum.product.events",
        aggregationTemporality: AggregationTemporality.Delta,
        metricPointType: MetricPointType.Sum,
        isMonotonic: true,
        time: "2026-11-10 12:00:00",
        startTime: "2026-11-10 12:00:00",
        attributes: { "event.name": "Signed up" },
        attributeKeys: ["event.name"],
        value: 7,
        retentionDate: "2026-11-25 12:00:00",
      }),
    );
  });

  test("an application whose retention could not be read keeps its points 30 days", () => {
    const rows: Array<JSONObject> = ProductAnalyticsDerivedMetrics.buildRows({
      buckets: [
        {
          projectId: PROJECT_ID,
          rumApplicationId: OTHER_APP_ID,
          metric: ProductAnalyticsDerivedMetric.Sessions,
          attributeKey: PRODUCT_ANALYTICS_DEVICE_TYPE_ATTRIBUTE,
          attributeValue: "desktop",
          minuteStartMs: MINUTE,
          count: 1,
        },
      ],
      retentionInDaysByApplication: new Map<string, number>(),
      writtenAt: new Date(MINUTE),
    });

    expect(rows[0]!["retentionDate"]).toBe("2026-12-10 12:00:00");
  });
});

describe("writing", () => {
  test("reads each application's retention once, writes the points, and puts the three names in the catalog once per project", async () => {
    ProductAnalyticsDerivedMetrics.countEvents(
      job([
        event(ProductAnalyticsEventKind.Session, "", MINUTE),
        event(ProductAnalyticsEventKind.Page, "/", MINUTE),
        event(ProductAnalyticsEventKind.Custom, "Signed up", MINUTE),
      ]),
    );

    await ProductAnalyticsDerivedMetrics.flush({ everything: true });

    expect(metadataMock).toHaveBeenCalledTimes(1);
    expect(writtenRows()).toHaveLength(3);
    expect(
      writtenRows()
        .map((row: JSONObject): string => {
          return row["name"] as string;
        })
        .sort(),
    ).toEqual([...PRODUCT_ANALYTICS_DERIVED_METRICS].sort());
    expect(indexMock).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(
        (
          indexMock.mock.calls[0]![0] as {
            metricNameServiceNameMap: Record<string, unknown>;
          }
        ).metricNameServiceNameMap,
      ).sort(),
    ).toEqual([...PRODUCT_ANALYTICS_DERIVED_METRICS].sort());

    ProductAnalyticsDerivedMetrics.countEvents(
      job([event(ProductAnalyticsEventKind.Custom, "Upgraded", MINUTE)]),
    );

    await ProductAnalyticsDerivedMetrics.flush({ everything: true });

    expect(writtenRows()).toHaveLength(4);
    expect(indexMock).toHaveBeenCalledTimes(1);
  });

  test("a failed write is logged and never thrown at the queue", async () => {
    insertMock.mockImplementation(async (): Promise<void> => {
      throw new Error("ClickHouse is down");
    });

    ProductAnalyticsDerivedMetrics.countEvents(
      job([event(ProductAnalyticsEventKind.Custom, "Signed up", MINUTE)]),
    );

    await expect(
      ProductAnalyticsDerivedMetrics.flush({ everything: true }),
    ).resolves.toBeUndefined();
    expect(indexMock).not.toHaveBeenCalled();
  });

  test("nothing due writes nothing", async () => {
    await ProductAnalyticsDerivedMetrics.flush({ everything: false });

    expect(insertMock).not.toHaveBeenCalled();
  });
});
