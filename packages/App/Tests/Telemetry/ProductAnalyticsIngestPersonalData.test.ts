import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import StatusCode from "Common/Types/API/StatusCode";
import { readSessionReplayFrustrationSignalsConfig } from "Common/Types/Rum/SessionReplayFrustrationSignals";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { SESSION_REPLAY_APP_IDENTIFIER_HEADER } from "Common/Types/Rum/SessionReplay";
import {
  PRODUCT_ANALYTICS_WIRE_VERSION,
  ProductAnalyticsEventKind,
  toProductAnalyticsPage,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import {
  PAGES_WITH_PERSONAL_DATA,
  PAGES_WITH_SECRETS,
  PAGE_SPELLINGS,
  PageSpellingCase,
  addressOf,
} from "Common/Tests/Helpers/PageSpellings";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";

/*
 * #8197: a product analytics batch from a client that does not scrub what
 * it sends - the application's own code posting with its ingestion key, a
 * recorder from before - through the real ingest: the route
 * (POST /session-replay/v1/events), its gate and batch claim, the parser,
 * the job, and the worker that writes it, down to the rows handed to the
 * writer for the events table and the metric store. Only what lies outside
 * the process is stood in for: the router, the key check, Redis, the
 * application's policy, the queue (which runs the worker at once) and the
 * writer (which keeps the rows it is given).
 *
 * Every page, page name, property, attribute and user property that is or
 * holds an address is stored scrubbed, as Session Replay's ingest scrubs
 * the addresses it keeps, whatever the client sent.
 */

const registeredPostHandlers: Record<string, Array<unknown>> = {};

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return {
          post: (uri: string, ...handlers: Array<unknown>) => {
            registeredPostHandlers[uri] = handlers;
          },
          get: (): void => {
            // No GET routes in this router.
          },
        };
      },
    },
    headerValueToString: (value: unknown): string | undefined => {
      if (typeof value === "string") {
        return value;
      }
      if (Array.isArray(value)) {
        return value[0] as string | undefined;
      }
      return undefined;
    },
  };
});

jest.mock("Common/Server/Middleware/TelemetryIngest", () => {
  return {
    __esModule: true,
    default: { forSurface: jest.fn(() => {}) },
  };
});

jest.mock("Common/Server/Middleware/TelemetryIngestionDisabled", () => {
  return { __esModule: true, default: { middleware: jest.fn() } };
});

jest.mock(
  "../../FeatureSet/Telemetry/Middleware/SessionReplayRequestMiddleware",
  () => {
    return { __esModule: true, default: { parseBody: jest.fn() } };
  },
);

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: { sendJsonObjectResponse: jest.fn() },
  };
});

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
    SESSION_REPLAY_TRUSTED_GEO_HEADER: "",
  };
});

/* A connected Redis whose strings and counters are in-memory maps. */
const redisStrings: Map<string, string> = new Map<string, string>();

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return {
          incrby: (key: string, by: number): Promise<number> => {
            const total: number = Number(redisStrings.get(key) || "0") + by;
            redisStrings.set(key, String(total));
            return Promise.resolve(total);
          },
          expire: (): Promise<number> => {
            return Promise.resolve(1);
          },
          get: (key: string): Promise<string | null> => {
            return Promise.resolve(redisStrings.get(key) ?? null);
          },
          set: (
            key: string,
            value: string,
            _expiryToken?: string,
            _seconds?: number,
            nxToken?: string,
          ): Promise<"OK" | null> => {
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
        return true;
      },
    },
  };
});

jest.mock("Common/Server/Utils/SessionReplay/SessionReplayGateCache", () => {
  return {
    __esModule: true,
    default: {
      resolvePolicy: jest.fn(),
      isOriginAllowed: jest.fn(() => {
        return true;
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/TelemetryFanInWriter", () => {
  return { __esModule: true, default: { submit: jest.fn() } };
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

jest.mock(
  "../../FeatureSet/Telemetry/Utils/ProductAnalyticsDerivedMetrics",
  () => {
    return { __esModule: true, default: { countEvents: jest.fn() } };
  },
);

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: { addProductAnalyticsEventsJob: jest.fn() },
    };
  },
);

import Response from "Common/Server/Utils/Response";
import SessionReplayGateCache, {
  SessionReplayGatePolicy,
} from "Common/Server/Utils/SessionReplay/SessionReplayGateCache";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import OTelIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import RumProductAnalyticsEventService from "Common/Server/Services/RumProductAnalyticsEventService";
import MetricService from "Common/Server/Services/MetricService";
import ProductAnalyticsEventIngestService from "../../FeatureSet/Telemetry/Services/ProductAnalyticsEventIngestService";
import TelemetryQueueService, {
  ProductAnalyticsEventsJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { sanitizeRoute } from "../../FeatureSet/MobileRecorder/src/Sanitize";
// Importing the router module registers the route on the mocked router.
import "../../FeatureSet/Telemetry/API/ProductAnalyticsEventIngest";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();
const USER_PROPERTY_KEYS: Array<string> = ["plan", "website"];

// What no stored row may hold once the ingest has read the batch.
const PERSONAL_DATA: Array<string> = [
  "someone",
  "First.Last",
  "jörg",
  "j%C3%B6rg",
  "3f1a9c7e",
  "3F1A9C7E",
  "5f8d0d55b54764421b7156c9",
  "4111111111111111",
  "Zx8",
  "abc123",
  "token=",
  "access_token",
  // #8385: a JSON Web Token's header, and an address escaped twice.
  "eyJhbGci",
  "%2540",
  // #8489: tokens in standard base64.
  "dGhpcyBp",
  "k3J",
];

function buildPolicy(): SessionReplayGatePolicy {
  return {
    projectId: PROJECT_ID,
    rumApplicationId: RUM_APPLICATION_ID,
    isProjectAllowed: true,
    isAppEnabled: true,
    allowedOrigins: ["https://shop.example.com"],
    maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
    consentMode: SessionReplayConsentMode.NotRequired,
    captureTrigger: SessionReplayCaptureTrigger.Always,
    samplePercentage: 100,
    maskSelectors: [],
    blockSelectors: [],
    recordCanvas: false,
    captureUserIdentity: true,
    captureGeo: false,
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
    productAnalyticsUserPropertyKeys: USER_PROPERTY_KEYS,
    pageRules: { recordOnly: [], neverRecord: [] },
    readableEventPropertyKeys: [],
    configEpoch: 1,
  };
}

interface Filed {
  status: number;
  eventRows: Array<JSONObject>;
  metricRows: Array<JSONObject>;
  job: ProductAnalyticsEventsJobData | undefined;
}

let batchCount: number = 0;

/*
 * Posts the batch to the route, as a client posts it, and runs the job it
 * queued through the worker. The rows are what the worker hands the writer.
 */
async function post(batch: JSONObject): Promise<Filed> {
  const handlers: Array<unknown> =
    registeredPostHandlers["/session-replay/v1/events"]!;
  const handler: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> = handlers[handlers.length - 1] as (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>;

  const submitted: Array<[unknown, Array<JSONObject>]> = [];
  let job: ProductAnalyticsEventsJobData | undefined = undefined;

  (TelemetryFanInWriter.submit as unknown as MockedFn).mockImplementation(
    (service: unknown, rows: unknown): unknown => {
      submitted.push([service, rows as Array<JSONObject>]);
      return { flushed: Promise.resolve() };
    },
  );
  (
    TelemetryQueueService.addProductAnalyticsEventsJob as unknown as MockedFn
  ).mockImplementation(async (queued: unknown): Promise<void> => {
    job = queued as ProductAnalyticsEventsJobData;
    // The worker, at once.
    await ProductAnalyticsEventIngestService.processFromQueue(job);
  });

  const sendJson: MockedFn =
    Response.sendJsonObjectResponse as unknown as MockedFn;
  sendJson.mockClear();

  batchCount++;

  await handler(
    {
      body: Buffer.from(
        JSON.stringify({
          batchId: batchCount.toString(16).padStart(32, "0"),
          ...batch,
        }),
      ),
      projectId: PROJECT_ID,
      headers: {
        [SESSION_REPLAY_APP_IDENTIFIER_HEADER]: "checkout-web",
        origin: "https://shop.example.com",
      },
    } as unknown as ExpressRequest,
    {
      setHeader: jest.fn(),
      status: jest.fn(),
      end: jest.fn(),
    } as unknown as ExpressResponse,
    ((err?: unknown): void => {
      if (err) {
        throw err;
      }
    }) as NextFunction,
  );

  const sent: Array<unknown> | undefined = sendJson.mock.calls[0];

  return {
    status: sent
      ? (
          (sent[3] as { statusCode: StatusCode }).statusCode as StatusCode
        ).toNumber()
      : 0,
    eventRows: submitted
      .filter((entry: [unknown, Array<JSONObject>]): boolean => {
        return entry[0] === RumProductAnalyticsEventService;
      })
      .flatMap((entry: [unknown, Array<JSONObject>]): Array<JSONObject> => {
        return entry[1];
      }),
    metricRows: submitted
      .filter((entry: [unknown, Array<JSONObject>]): boolean => {
        return entry[0] === MetricService;
      })
      .flatMap((entry: [unknown, Array<JSONObject>]): Array<JSONObject> => {
        return entry[1];
      }),
    job: job,
  };
}

function wireBatch(events: Array<JSONObject>, extra?: JSONObject): JSONObject {
  return {
    v: PRODUCT_ANALYTICS_WIRE_VERSION,
    sessionId: "b".repeat(32),
    visitorId: "c".repeat(32),
    consentState: "NotRequired",
    sentAt: Date.now(),
    context: { deviceType: "desktop", browserName: "Chrome", osName: "Linux" },
    events: events,
    metrics: [],
    ...extra,
  };
}

function expectNoOne(rows: Array<JSONObject>): void {
  const text: string = JSON.stringify(rows);

  for (const personal of PERSONAL_DATA) {
    expect([personal, text.includes(personal)]).toEqual([personal, false]);
  }
}

beforeEach(() => {
  redisStrings.clear();
  (SessionReplayGateCache.resolvePolicy as unknown as MockedFn).mockReset();
  (
    SessionReplayGateCache.resolvePolicy as unknown as MockedFn
  ).mockImplementation(async (): Promise<unknown> => {
    return { policy: buildPolicy(), refusal: null };
  });
  (
    OTelIngestService.buildResourceMetadataForNonService as unknown as MockedFn
  ).mockImplementation(async (): Promise<unknown> => {
    return {
      serviceRetentionConfig: null,
      serviceRetentionInDays: 15,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    };
  });
});

describe("a batch a client sent unscrubbed, through the real ingest", () => {
  test("the batch of the report: a page view named by a path with an email is stored scrubbed", async () => {
    const filed: Filed = await post(
      wireBatch([
        {
          kind: ProductAnalyticsEventKind.Page,
          name: "/users/someone@example.com",
          at: Date.now(),
        },
      ]),
    );

    expect(filed.status).toBe(202);
    expect(filed.eventRows).toHaveLength(1);
    expect(filed.eventRows[0]!["name"]).toBe("/users/[redacted]");
    expect(filed.eventRows[0]!["page"]).toBe("/users/[redacted]");
  });

  test.each(
    [...PAGES_WITH_PERSONAL_DATA, ...PAGES_WITH_SECRETS].map(
      (row: PageSpellingCase): [string, PageSpellingCase] => {
        return [row.name, row];
      },
    ),
  )(
    "every kind of event, every field that is an address, is stored scrubbed: %s",
    async (_name: string, row: PageSpellingCase) => {
      const address: string = addressOf(row);
      const filed: Filed = await post(
        wireBatch(
          [
            {
              kind: ProductAnalyticsEventKind.Session,
              page: address,
              at: Date.now(),
            },
            {
              kind: ProductAnalyticsEventKind.Page,
              name: row.sent,
              at: Date.now(),
            },
            {
              kind: ProductAnalyticsEventKind.Page,
              page: address,
              at: Date.now(),
            },
            {
              kind: ProductAnalyticsEventKind.Custom,
              name: "Ordered",
              page: row.sent,
              at: Date.now(),
              properties: { url: address, referrer: row.sent, plan: "pro" },
            },
          ],
          {
            userRef: "user-42",
            userProperties: {
              plan: "pro",
              website: address,
              email: "someone@example.com",
            },
            metrics: [
              {
                name: "checkout.duration_ms",
                value: 1834,
                at: Date.now(),
                attributes: { page: address, step: "payment" },
              },
            ],
          },
        ),
      );

      expect(filed.status).toBe(202);
      expect(
        filed.eventRows.map((stored: JSONObject): string => {
          return `${stored["kind"]} ${stored["name"]} ${stored["page"]}`;
        }),
      ).toEqual([
        `session  ${row.page}`,
        `page ${row.page} ${row.page}`,
        `page ${row.page} ${row.page}`,
        `custom Ordered ${row.page}`,
      ]);

      const scrubbedAddress: string = UrlScrubber.scrub(address, []);

      expect(filed.eventRows[3]!["properties"]).toEqual({
        url: scrubbedAddress,
        referrer: expect.any(String),
        plan: "pro",
      });
      expect(filed.metricRows).toHaveLength(1);
      expect(filed.metricRows[0]!["attributes"]).toEqual({
        page: scrubbedAddress,
        step: "payment",
      });
      // Only the listed traits, the address one scrubbed.
      expect(filed.eventRows[0]!["userProperties"]).toEqual({
        plan: "pro",
        website: scrubbedAddress,
      });
      // The page of the address the event kept is the page it was filed on.
      expect(toProductAnalyticsPage(scrubbedAddress)).toBe(row.page);

      expectNoOne(filed.eventRows);
      expectNoOne(filed.metricRows);
    },
  );

  test("a batch from the recorder, already scrubbed, is stored as it was sent", async () => {
    const pages: Array<string> = [
      ...PAGE_SPELLINGS,
      ...PAGES_WITH_PERSONAL_DATA,
      ...PAGES_WITH_SECRETS,
    ].map((row: PageSpellingCase): string => {
      return row.page;
    });
    const filed: Filed = await post(
      wireBatch(
        pages.map((page: string): JSONObject => {
          return {
            kind: ProductAnalyticsEventKind.Page,
            name: page,
            at: Date.now(),
          };
        }),
      ),
    );

    expect(
      filed.eventRows.map((stored: JSONObject): unknown => {
        return stored["name"];
      }),
    ).toEqual(pages);
  });

  /*
   * The React Native recorder sends no events yet. When it does, it names a
   * screen as it names its routes (sanitizeRoute), which redacts with the
   * scrubber's rule too, so a screen is one page in the replay and in the
   * events.
   */
  test.each([
    "Checkout",
    "Orders/42",
    "Profile/someone@example.com",
    "Reset/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
    "Accounts/4111111111111111",
    "ProductDetailsScreenWithLongName",
    "/users/someone%40example.com?tab=orders",
    "/",
    // #8385: a token, and an address escaped twice.
    "Session/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
    "Invite/someone%2540example.com",
    "Files/report-2026-11-15.pdf",
  ])(
    "a mobile app's screen %p is the page the mobile recorder's route names",
    (screen: string) => {
      expect(toProductAnalyticsPage(screen)).toBe(sanitizeRoute(screen));
    },
  );
});
