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
import { readSessionReplayFrustrationSignalsConfig } from "Common/Types/Rum/SessionReplayFrustrationSignals";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  PRODUCT_ANALYTICS_MAX_ITEMS_PER_PROJECT_PER_MINUTE,
  ProductAnalyticsEventKind,
  ProductAnalyticsParsedBatch,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import { MetricPointType } from "Common/Models/AnalyticsModels/Metric";

/*
 * ProductAnalyticsEventIngestService (issue #6444, part two): the gate a
 * product analytics batch passes at the route, the batch id claimed once a
 * day, the job built from what passed, and the worker that files it.
 *
 *   - The gate is Session Replay's policy plus one switch: replay allowed
 *     and on, product analytics on, an allowed origin, consent when the
 *     application asks for it, and the project's per-minute allowance -
 *     which fails closed without Redis.
 *   - A signed-in user's reference becomes its one-way key, and the user's
 *     properties travel, only when the application captures identity.
 *   - The worker files the events once per batch id even when it runs
 *     again, writes each metric() point as a Gauge under the RUM
 *     application with only the attributes the page gave, puts new names in
 *     the metric catalog once, and counts the events into the per-minute
 *     series.
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

jest.mock("../../FeatureSet/Telemetry/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Telemetry/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    SESSION_REPLAY_INGEST_ENABLED: true,
    SESSION_REPLAY_ENABLED_BY_DEFAULT: true,
  };
});

/* A connected Redis whose strings and counters are real in-memory maps. */
const redisStrings: Map<string, string> = new Map<string, string>();
const expireMock: ReturnType<typeof jest.fn> = jest.fn();
let redisConnected: boolean = true;
let redisFails: boolean = false;

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        if (!redisConnected) {
          return null;
        }

        const failing: () => Promise<never> = (): Promise<never> => {
          return Promise.reject(new Error("Redis is down"));
        };

        return {
          incrby: (key: string, by: number): Promise<number> => {
            if (redisFails) {
              return failing();
            }

            const total: number = Number(redisStrings.get(key) || "0") + by;
            redisStrings.set(key, String(total));
            return Promise.resolve(total);
          },
          expire: (...args: Array<unknown>): Promise<number> => {
            expireMock(...args);
            return Promise.resolve(1);
          },
          get: (key: string): Promise<string | null> => {
            if (redisFails) {
              return failing();
            }

            return Promise.resolve(redisStrings.get(key) ?? null);
          },
          set: (
            key: string,
            value: string,
            _expiryToken?: string,
            _seconds?: number,
            nxToken?: string,
          ): Promise<"OK" | null> => {
            if (redisFails) {
              return failing();
            }

            if (nxToken === "NX" && redisStrings.has(key)) {
              return Promise.resolve(null);
            }

            redisStrings.set(key, value);
            return Promise.resolve("OK");
          },
          del: (key: string): Promise<number> => {
            redisStrings.delete(key);
            return Promise.resolve(1);
          },
        };
      },
      isConnected: (): boolean => {
        return redisConnected;
      },
    },
  };
});

jest.mock("Common/Server/Utils/SessionReplay/SessionReplayGateCache", () => {
  return {
    __esModule: true,
    default: {
      resolvePolicy: jest.fn(),
      isOriginAllowed: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/TelemetryFanInWriter", () => {
  return {
    __esModule: true,
    default: {
      submit: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/RumProductAnalyticsEventService", () => {
  return {
    __esModule: true,
    default: { model: { tableName: "RumProductAnalyticsEventV1" } },
  };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { model: { tableName: "MetricItemV2" } },
  };
});

jest.mock("Common/Server/Services/OpenTelemetryIngestService", () => {
  return {
    __esModule: true,
    default: {
      buildResourceMetadataForNonService: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      getAttributeKeys: (attributes: Record<string, unknown>): Array<string> => {
        return Object.keys(attributes).sort();
      },
      indexMetricNameServiceNameMap: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Utils/ProductAnalyticsDerivedMetrics", () => {
  return {
    __esModule: true,
    default: {
      countEvents: jest.fn(),
    },
  };
});

import SessionReplayGateCache, {
  SessionReplayGatePolicy,
} from "Common/Server/Utils/SessionReplay/SessionReplayGateCache";
import SessionReplayIdentity from "Common/Server/Utils/SessionReplay/SessionReplayIdentity";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import OTelIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import RumProductAnalyticsEventService from "Common/Server/Services/RumProductAnalyticsEventService";
import MetricService from "Common/Server/Services/MetricService";
import ProductAnalyticsDerivedMetrics from "../../FeatureSet/Telemetry/Utils/ProductAnalyticsDerivedMetrics";
import ProductAnalyticsEventIngestService, {
  ProductAnalyticsGateDecision,
  ProductAnalyticsGateOutcome,
} from "../../FeatureSet/Telemetry/Services/ProductAnalyticsEventIngestService";
import { ProductAnalyticsEventsJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

type MockedFn = ReturnType<typeof jest.fn>;

const resolvePolicyMock: MockedFn =
  SessionReplayGateCache.resolvePolicy as unknown as MockedFn;
const isOriginAllowedMock: MockedFn =
  SessionReplayGateCache.isOriginAllowed as unknown as MockedFn;
const submitMock: MockedFn = TelemetryFanInWriter.submit as unknown as MockedFn;
const indexMetricNamesMock: MockedFn =
  TelemetryUtil.indexMetricNameServiceNameMap as unknown as MockedFn;
const metadataMock: MockedFn =
  OTelIngestService.buildResourceMetadataForNonService as unknown as MockedFn;
const countEventsMock: MockedFn =
  ProductAnalyticsDerivedMetrics.countEvents as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();
const RECEIVED_AT: number = Date.UTC(2026, 10, 10, 12, 0, 30);

function buildPolicy(
  overrides?: Partial<SessionReplayGatePolicy>,
): SessionReplayGatePolicy {
  return {
    projectId: PROJECT_ID,
    rumApplicationId: RUM_APPLICATION_ID,
    isProjectAllowed: true,
    isAppEnabled: true,
    allowedOrigins: ["https://shop.example.com"],
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    consentMode: SessionReplayConsentMode.NotRequired,
    captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    samplePercentage: 100,
    maskSelectors: [],
    blockSelectors: [],
    recordCanvas: false,
    captureUserIdentity: false,
    captureGeo: true,
    retentionInDays: 7,
    monthlyBudgetInGB: null,
    ignoreErrorPatterns: [],
    tracePropagationOrigins: [],
    sameOriginTracePropagation: true,
    lcpBudgetMs: 0,
    longTaskBudgetMs: 0,
    slowRequestBudgetMs: 0,
    frustrationSignals: readSessionReplayFrustrationSignalsConfig(null),
    isProductAnalyticsEnabled: true,
    productAnalyticsUserPropertyKeys: ["plan"],
    configEpoch: 1,
    ...overrides,
  };
}

function buildBatch(
  overrides?: Partial<ProductAnalyticsParsedBatch>,
): ProductAnalyticsParsedBatch {
  return {
    batchId: "a".repeat(32),
    sessionId: "b".repeat(32),
    visitorId: "c".repeat(32),
    userRef: "user-42",
    userProperties: { plan: "pro" },
    context: {
      deviceType: "mobile",
      browserName: "Safari",
      osName: "iOS",
      appVersion: "",
    },
    events: [
      {
        kind: ProductAnalyticsEventKind.Custom,
        name: "Signed up",
        time: RECEIVED_AT - 1000,
        page: "/signup",
        properties: { source: "ad" },
      },
    ],
    metrics: [
      {
        name: "cart.value",
        value: 42.5,
        time: RECEIVED_AT - 500,
        attributes: { currency: "EUR" },
      },
    ],
    droppedEvents: 0,
    droppedMetrics: 0,
    droppedTooOld: 0,
    ...overrides,
  };
}

async function gate(
  overrides?: Partial<{
    origin: string | undefined;
    consentState: string;
    itemCount: number;
  }>,
): Promise<ProductAnalyticsGateDecision> {
  return ProductAnalyticsEventIngestService.gateBatch({
    projectId: PROJECT_ID,
    appIdentifier: "checkout-web",
    origin: "https://shop.example.com",
    consentState: "NotRequired",
    itemCount: 2,
    ...overrides,
  });
}

function buildJob(
  policy: SessionReplayGatePolicy,
  batch?: ProductAnalyticsParsedBatch,
): ProductAnalyticsEventsJobData {
  return ProductAnalyticsEventIngestService.buildJob({
    projectId: PROJECT_ID,
    policy: policy,
    batch: batch || buildBatch(),
    receivedAtUnixMs: RECEIVED_AT,
    countryCode: "DE",
  });
}

beforeEach(() => {
  redisStrings.clear();
  redisConnected = true;
  redisFails = false;
  expireMock.mockReset();
  resolvePolicyMock.mockReset();
  resolvePolicyMock.mockImplementation(async (): Promise<unknown> => {
    return { policy: buildPolicy(), refusal: null };
  });
  isOriginAllowedMock.mockReset();
  isOriginAllowedMock.mockReturnValue(true);
  submitMock.mockReset();
  submitMock.mockImplementation((): unknown => {
    return { flushed: Promise.resolve() };
  });
  indexMetricNamesMock.mockReset();
  indexMetricNamesMock.mockImplementation(async (): Promise<void> => {});
  metadataMock.mockReset();
  metadataMock.mockImplementation(async (): Promise<unknown> => {
    return {
      serviceRetentionConfig: null,
      serviceRetentionInDays: 15,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    };
  });
  countEventsMock.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the gate", () => {
  test("accepts a batch from an allowed origin of an application with events on, and hands back its policy", async () => {
    const decision: ProductAnalyticsGateDecision = await gate();

    expect(decision.outcome).toBe(ProductAnalyticsGateOutcome.Accepted);
    expect(decision.policy?.rumApplicationId.toString()).toBe(
      RUM_APPLICATION_ID.toString(),
    );
    expect(resolvePolicyMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      appIdentifier: "checkout-web",
    });
  });

  test("stops the recorder, with replay's own reason, when there is no policy", async () => {
    resolvePolicyMock.mockImplementation(async (): Promise<unknown> => {
      return { policy: null, refusal: "project-not-allowed" };
    });

    expect(await gate()).toEqual({
      outcome: ProductAnalyticsGateOutcome.Stop,
      reason: "project-not-allowed",
    });
  });

  test("stops the recorder when the application has events off", async () => {
    resolvePolicyMock.mockImplementation(async (): Promise<unknown> => {
      return {
        policy: buildPolicy({ isProductAnalyticsEnabled: false }),
        refusal: null,
      };
    });

    const decision: ProductAnalyticsGateDecision = await gate();

    expect(decision.outcome).toBe(ProductAnalyticsGateOutcome.Stop);
    expect(decision.reason).toBe("product-analytics-not-enabled");
    /* Nothing counted against the allowance. */
    expect(redisStrings.size).toBe(0);
  });

  test("refuses an origin the application does not allow", async () => {
    isOriginAllowedMock.mockReturnValue(false);

    const decision: ProductAnalyticsGateDecision = await gate({
      origin: "https://evil.example.net",
    });

    expect(decision.outcome).toBe(ProductAnalyticsGateOutcome.OriginRefused);
    expect(isOriginAllowedMock).toHaveBeenCalledWith(
      expect.objectContaining({ isProductAnalyticsEnabled: true }),
      "https://evil.example.net",
    );
  });

  test.each([
    ["Unknown", ProductAnalyticsGateOutcome.Refused],
    ["NotRequired", ProductAnalyticsGateOutcome.Refused],
    ["", ProductAnalyticsGateOutcome.Refused],
    ["Granted", ProductAnalyticsGateOutcome.Accepted],
  ])(
    "under explicit consent, a batch whose consent is %p is %s",
    async (consentState: string, outcome: ProductAnalyticsGateOutcome) => {
      resolvePolicyMock.mockImplementation(async (): Promise<unknown> => {
        return {
          policy: buildPolicy({
            consentMode: SessionReplayConsentMode.RequireExplicit,
          }),
          refusal: null,
        };
      });

      expect((await gate({ consentState: consentState })).outcome).toBe(
        outcome,
      );
    },
  );

  test("a policy that cannot be read is retried in 30 seconds", async () => {
    resolvePolicyMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Postgres is down");
    });

    expect(await gate()).toEqual({
      outcome: ProductAnalyticsGateOutcome.Unavailable,
      reason: "policy-unavailable",
      retryAfterSeconds: 30,
    });
  });

  test("counts every item against the project's minute, and refuses past it until the next minute", async () => {
    jest.spyOn(Date, "now").mockReturnValue(RECEIVED_AT);

    expect(
      (await gate({ itemCount: PRODUCT_ANALYTICS_MAX_ITEMS_PER_PROJECT_PER_MINUTE }))
        .outcome,
    ).toBe(ProductAnalyticsGateOutcome.Accepted);
    /* The minute's counter is set to expire when it is first written. */
    expect(expireMock).toHaveBeenCalledTimes(1);

    const refused: ProductAnalyticsGateDecision = await gate({ itemCount: 1 });

    expect(refused.outcome).toBe(ProductAnalyticsGateOutcome.RateLimited);
    /* 30 seconds into the minute: 30 to wait. */
    expect(refused.retryAfterSeconds).toBe(30);
    expect(expireMock).toHaveBeenCalledTimes(1);
  });

  test("an empty batch still counts as one item", async () => {
    await gate({ itemCount: 0 });

    expect(Array.from(redisStrings.values())).toEqual(["1"]);
  });

  test("fails closed when the counter cannot be reached", async () => {
    redisConnected = false;

    expect((await gate()).outcome).toBe(
      ProductAnalyticsGateOutcome.Unavailable,
    );

    redisConnected = true;
    redisFails = true;

    const decision: ProductAnalyticsGateDecision = await gate();

    expect(decision.outcome).toBe(ProductAnalyticsGateOutcome.Unavailable);
    expect(decision.reason).toBe("rate-counter-unavailable");
    expect(decision.retryAfterSeconds).toBe(30);
  });
});

describe("the batch id", () => {
  test("is claimed once a day: a resend is a duplicate, and a released claim can be claimed again", async () => {
    const claim: { projectId: ObjectID; batchId: string } = {
      projectId: PROJECT_ID,
      batchId: "a".repeat(32),
    };

    expect(await ProductAnalyticsEventIngestService.claimBatch(claim)).toBe(
      "claimed",
    );
    expect(await ProductAnalyticsEventIngestService.claimBatch(claim)).toBe(
      "duplicate",
    );
    /* Another project's batch of the same id is its own. */
    expect(
      await ProductAnalyticsEventIngestService.claimBatch({
        ...claim,
        projectId: ObjectID.generate(),
      }),
    ).toBe("claimed");

    await ProductAnalyticsEventIngestService.releaseBatch(claim);

    expect(await ProductAnalyticsEventIngestService.claimBatch(claim)).toBe(
      "claimed",
    );
  });

  test("cannot be claimed without Redis", async () => {
    redisConnected = false;

    expect(
      await ProductAnalyticsEventIngestService.claimBatch({
        projectId: PROJECT_ID,
        batchId: "a".repeat(32),
      }),
    ).toBe("unavailable");

    redisConnected = true;
    redisFails = true;

    expect(
      await ProductAnalyticsEventIngestService.claimBatch({
        projectId: PROJECT_ID,
        batchId: "a".repeat(32),
      }),
    ).toBe("unavailable");
  });
});

describe("the job", () => {
  test("keeps no user when the application does not capture identity", () => {
    const job: ProductAnalyticsEventsJobData = buildJob(buildPolicy());

    expect(job.identifiedUserKey).toBe("");
    expect(job.userProperties).toEqual({});
    expect(JSON.stringify(job)).not.toContain("user-42");
  });

  test("turns the user's reference into its one-way key when it does, and never queues the reference", () => {
    const job: ProductAnalyticsEventsJobData = buildJob(
      buildPolicy({ captureUserIdentity: true }),
    );

    expect(job.identifiedUserKey).toBe(
      SessionReplayIdentity.buildUserKey({
        projectId: PROJECT_ID,
        userRef: "user-42",
      }),
    );
    expect(job.userProperties).toEqual({ plan: "pro" });
    expect(JSON.stringify(job)).not.toContain("user-42");
  });

  test("a batch with nobody signed in has no user even when identity is captured", () => {
    const job: ProductAnalyticsEventsJobData = buildJob(
      buildPolicy({ captureUserIdentity: true }),
      buildBatch({ userRef: "", userProperties: {} }),
    );

    expect(job.identifiedUserKey).toBe("");
  });

  test("carries the application, the batch, the country and what the batch held", () => {
    const job: ProductAnalyticsEventsJobData = buildJob(buildPolicy());

    expect(job).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID.toString(),
        rumApplicationId: RUM_APPLICATION_ID.toString(),
        batchId: "a".repeat(32),
        receivedAtUnixMs: RECEIVED_AT,
        countryCode: "DE",
        sessionId: "b".repeat(32),
        visitorId: "c".repeat(32),
      }),
    );
    expect(job.events).toHaveLength(1);
    expect(job.metrics).toHaveLength(1);
  });
});

describe("the rows", () => {
  test("one event row per event, with the session's context and the person's key", () => {
    const job: ProductAnalyticsEventsJobData = buildJob(
      buildPolicy({ captureUserIdentity: true }),
    );
    const rows: Array<JSONObject> =
      ProductAnalyticsEventIngestService.buildEventRows(job);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      projectId: PROJECT_ID.toString(),
      rumApplicationId: RUM_APPLICATION_ID.toString(),
      kind: "custom",
      name: "Signed up",
      time: expect.any(String),
      sessionId: "b".repeat(32),
      visitorId: "c".repeat(32),
      identifiedUserKey: job.identifiedUserKey,
      page: "/signup",
      deviceType: "mobile",
      browserName: "Safari",
      osName: "iOS",
      countryCode: "DE",
      appVersion: "",
      properties: { source: "ad" },
      userProperties: { plan: "pro" },
    });
  });

  test("one Gauge point per metric() call under the RUM application, with only the page's attributes", () => {
    const job: ProductAnalyticsEventsJobData = buildJob(
      buildPolicy({ captureUserIdentity: true }),
    );
    const rows: Array<JSONObject> =
      ProductAnalyticsEventIngestService.buildMetricRows({
        job: job,
        retentionInDays: 15,
      });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID.toString(),
        primaryEntityId: RUM_APPLICATION_ID.toString(),
        primaryEntityType: ServiceType.RealUserMonitor,
        name: "cart.value",
        metricPointType: MetricPointType.Gauge,
        value: 42.5,
        attributes: { currency: "EUR" },
        attributeKeys: ["currency"],
      }),
    );
    /* No session, no person: a series per person can never be made. */
    expect(JSON.stringify(rows[0])).not.toContain("b".repeat(32));
    expect(JSON.stringify(rows[0])).not.toContain(job.identifiedUserKey);
    /* "YYYY-MM-DD HH:mm:ss" in UTC, read back as an instant. */
    const readUtc: (text: string) => number = (text: string): number => {
      return new Date(`${text.replace(" ", "T")}Z`).getTime();
    };

    expect(
      readUtc(rows[0]!["retentionDate"] as string) -
        readUtc(rows[0]!["time"] as string),
    ).toBe(15 * 24 * 60 * 60 * 1000);
  });
});

describe("the worker", () => {
  test("files the events, the metric points, the new names and the per-minute counts", async () => {
    const job: ProductAnalyticsEventsJobData = buildJob(buildPolicy());

    await ProductAnalyticsEventIngestService.processFromQueue(job);

    expect(submitMock).toHaveBeenCalledTimes(2);
    expect(submitMock.mock.calls[0]![0]).toBe(RumProductAnalyticsEventService);
    expect(submitMock.mock.calls[1]![0]).toBe(MetricService);
    expect(countEventsMock).toHaveBeenCalledWith(job);
    expect(indexMetricNamesMock).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(
        (indexMetricNamesMock.mock.calls[0]![0] as {
          metricNameServiceNameMap: Record<string, unknown>;
        }).metricNameServiceNameMap,
      ),
    ).toEqual(["cart.value"]);
  });

  test("run again for the same batch, files its events once and the points again", async () => {
    const job: ProductAnalyticsEventsJobData = buildJob(buildPolicy(), {
      ...buildBatch(),
      batchId: "d".repeat(32),
      metrics: [
        {
          name: "checkout.ms",
          value: 1200,
          time: RECEIVED_AT,
          attributes: {},
        },
      ],
    });

    await ProductAnalyticsEventIngestService.processFromQueue(job);
    await ProductAnalyticsEventIngestService.processFromQueue(job);

    const tables: Array<unknown> = submitMock.mock.calls.map(
      (call: Array<unknown>): unknown => {
        return call[0];
      },
    );

    expect(
      tables.filter((table: unknown): boolean => {
        return table === RumProductAnalyticsEventService;
      }),
    ).toHaveLength(1);
    expect(
      tables.filter((table: unknown): boolean => {
        return table === MetricService;
      }),
    ).toHaveLength(2);
    expect(countEventsMock).toHaveBeenCalledTimes(1);
    /* A name this process put in the catalog is not written again. */
    expect(indexMetricNamesMock).toHaveBeenCalledTimes(1);
  });

  test("a failed write fails the job, so it runs again", async () => {
    submitMock.mockImplementation((): unknown => {
      return { flushed: Promise.reject(new Error("ClickHouse is down")) };
    });

    await expect(
      ProductAnalyticsEventIngestService.processFromQueue(
        buildJob(buildPolicy(), { ...buildBatch(), batchId: "e".repeat(32) }),
      ),
    ).rejects.toThrow("ClickHouse is down");
    expect(countEventsMock).not.toHaveBeenCalled();
  });

  test("a batch of metric points alone writes no event rows", async () => {
    await ProductAnalyticsEventIngestService.processFromQueue(
      buildJob(buildPolicy(), {
        ...buildBatch(),
        batchId: "f".repeat(32),
        events: [],
      }),
    );

    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(submitMock.mock.calls[0]![0]).toBe(MetricService);
    expect(countEventsMock).not.toHaveBeenCalled();
  });
});
