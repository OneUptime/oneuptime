import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import StatusCode from "Common/Types/API/StatusCode";
import { JSONObject } from "Common/Types/JSON";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import {
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_RECORDER_KIND_HEADER,
} from "Common/Types/Rum/SessionReplay";
import {
  PRODUCT_ANALYTICS_EVENTS_ROUTE,
  PRODUCT_ANALYTICS_MAX_BATCH_BYTES,
  PRODUCT_ANALYTICS_WIRE_VERSION,
  ProductAnalyticsEventKind,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";

/*
 * POST /session-replay/v1/events (issue #6444, part two): the door a RUM
 * recorder's product analytics batch comes through. What each answer means
 * to the recorder is the contract, so every answer is pinned here: the
 * route's own checks, the gate's outcomes as status codes, the batch id
 * claim, the job queued before the 202, and the country kept only when the
 * application captures it.
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

const authMiddleware: unknown = jest.fn();

jest.mock("Common/Server/Middleware/TelemetryIngest", () => {
  return {
    __esModule: true,
    default: {
      forSurface: jest.fn(() => {
        return authMiddleware;
      }),
    },
  };
});

const ingestionDisabledMiddleware: unknown = jest.fn();

jest.mock("Common/Server/Middleware/TelemetryIngestionDisabled", () => {
  return {
    __esModule: true,
    default: {
      middleware: ingestionDisabledMiddleware,
    },
  };
});

const parseBodyMiddleware: unknown = jest.fn();

jest.mock(
  "../../FeatureSet/Telemetry/Middleware/SessionReplayRequestMiddleware",
  () => {
    return {
      __esModule: true,
      default: {
        parseBody: parseBodyMiddleware,
      },
    };
  },
);

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
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

/* The trusted proxy's country header; "" when the instance has none. */
let trustedGeoHeader: string = "cf-ipcountry";

jest.mock("../../FeatureSet/Telemetry/Config", () => {
  return {
    __esModule: true,
    get SESSION_REPLAY_TRUSTED_GEO_HEADER(): string {
      return trustedGeoHeader;
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/ProductAnalyticsEventIngestService",
  () => {
    return {
      __esModule: true,
      default: {
        gateBatch: jest.fn(),
        claimBatch: jest.fn(),
        releaseBatch: jest.fn(),
        buildJob: jest.fn(),
      },
      ProductAnalyticsGateOutcome: {
        Accepted: "accepted",
        Duplicate: "duplicate",
        Stop: "stop",
        Refused: "refused",
        OriginRefused: "origin-refused",
        RateLimited: "rate-limited",
        Unavailable: "unavailable",
      },
    };
  },
);

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addProductAnalyticsEventsJob: jest.fn(),
      },
    };
  },
);

import Response from "Common/Server/Utils/Response";
import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import ProductAnalyticsEventIngestService, {
  ProductAnalyticsGateOutcome,
} from "../../FeatureSet/Telemetry/Services/ProductAnalyticsEventIngestService";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
// Importing the router module registers the route on the mocked router.
import "../../FeatureSet/Telemetry/API/ProductAnalyticsEventIngest";

type MockedFn = ReturnType<typeof jest.fn>;

const gateMock: MockedFn =
  ProductAnalyticsEventIngestService.gateBatch as unknown as MockedFn;
const claimMock: MockedFn =
  ProductAnalyticsEventIngestService.claimBatch as unknown as MockedFn;
const releaseMock: MockedFn =
  ProductAnalyticsEventIngestService.releaseBatch as unknown as MockedFn;
const buildJobMock: MockedFn =
  ProductAnalyticsEventIngestService.buildJob as unknown as MockedFn;
const addJobMock: MockedFn =
  TelemetryQueueService.addProductAnalyticsEventsJob as unknown as MockedFn;
const sendJsonMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const forSurfaceMock: MockedFn =
  TelemetryIngest.forSurface as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const APP_IDENTIFIER: string = "checkout-web";
const BATCH_ID: string = "a".repeat(32);

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  ended: boolean;
  setHeader: (name: string, value: string) => void;
  status: (code: number) => FakeResponse;
  end: () => void;
}

function buildResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 0,
    headers: {},
    ended: false,
    setHeader: (name: string, value: string): void => {
      res.headers[name] = value;
    },
    status: (code: number): FakeResponse => {
      res.statusCode = code;
      return res;
    },
    end: (): void => {
      res.ended = true;
    },
  };

  return res;
}

function buildBatch(overrides?: JSONObject): JSONObject {
  return {
    v: PRODUCT_ANALYTICS_WIRE_VERSION,
    batchId: BATCH_ID,
    sessionId: "b".repeat(32),
    visitorId: "c".repeat(32),
    consentState: "Granted",
    context: {
      deviceType: "desktop",
      browserName: "Firefox",
      osName: "Linux",
      appVersion: "",
    },
    events: [
      { kind: ProductAnalyticsEventKind.Session, name: "", at: Date.now() },
      {
        kind: ProductAnalyticsEventKind.Custom,
        name: "Signed up",
        at: Date.now(),
        properties: { plan: "pro" },
      },
    ],
    metrics: [{ name: "cart.value", value: 3, at: Date.now() }],
    ...overrides,
  };
}

function toBody(batch: JSONObject): Buffer {
  return Buffer.from(JSON.stringify(batch));
}

interface Answer {
  res: FakeResponse;
  status: number;
  body: JSONObject | null;
  nextError: unknown;
}

async function post(data?: {
  body?: unknown;
  headers?: Record<string, string>;
  resolvedClientOrigin?: string;
}): Promise<Answer> {
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

  const res: FakeResponse = buildResponse();
  let nextError: unknown = undefined;

  const req: Record<string, unknown> = {
    body: data && "body" in data ? data.body : toBody(buildBatch()),
    projectId: PROJECT_ID,
    headers: {
      [SESSION_REPLAY_APP_IDENTIFIER_HEADER]: APP_IDENTIFIER,
      origin: "https://shop.example.com",
      ...(data?.headers || {}),
    },
  };

  if (data?.resolvedClientOrigin !== undefined) {
    req["resolvedClientOrigin"] = data.resolvedClientOrigin;
  }

  sendJsonMock.mockClear();

  await handler(
    req as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
    ((err?: unknown): void => {
      nextError = err;
    }) as NextFunction,
  );

  const sent: Array<unknown> | undefined = sendJsonMock.mock.calls[0];

  if (sent) {
    return {
      res,
      status: (
        (sent[3] as { statusCode: StatusCode }).statusCode as StatusCode
      ).toNumber(),
      body: sent[2] as JSONObject,
      nextError,
    };
  }

  return { res, status: res.statusCode, body: null, nextError };
}

function accept(policy?: Partial<{ captureGeo: boolean }>): void {
  gateMock.mockImplementation(async (): Promise<unknown> => {
    return {
      outcome: ProductAnalyticsGateOutcome.Accepted,
      reason: "accepted",
      policy: {
        captureGeo: true,
        productAnalyticsUserPropertyKeys: [],
        ...policy,
      },
    };
  });
}

beforeEach(() => {
  trustedGeoHeader = "cf-ipcountry";
  gateMock.mockReset();
  accept();
  claimMock.mockReset();
  claimMock.mockImplementation(async (): Promise<string> => {
    return "claimed";
  });
  releaseMock.mockReset();
  buildJobMock.mockReset();
  buildJobMock.mockImplementation((data: unknown): unknown => {
    return { job: data };
  });
  addJobMock.mockReset();
  addJobMock.mockImplementation(async (): Promise<void> => {});
});

describe("the route", () => {
  test("is the recorder's events path, behind the ingest switch, the replay surface's key check and the replay body reader, in that order", () => {
    expect(PRODUCT_ANALYTICS_EVENTS_ROUTE).toBe("/session-replay/v1/events");

    const handlers: Array<unknown> =
      registeredPostHandlers[PRODUCT_ANALYTICS_EVENTS_ROUTE]!;

    expect(handlers).toHaveLength(4);
    expect(handlers[0]).toBe(ingestionDisabledMiddleware);
    expect(handlers[1]).toBe(authMiddleware);
    expect(handlers[2]).toBe(parseBodyMiddleware);
    expect(forSurfaceMock).toHaveBeenCalledWith(
      TelemetryIngestSurface.SessionReplay,
    );
  });
});

describe("what the route refuses before the gate", () => {
  test("a body that is not raw bytes", async () => {
    const answer: Answer = await post({ body: { v: 1 } });

    expect(answer.status).toBe(400);
    expect(answer.body?.["reason"]).toBe("malformed-body");
    expect(gateMock).not.toHaveBeenCalled();
  });

  test("a batch over the size cap, without reading it", async () => {
    const answer: Answer = await post({
      body: Buffer.alloc(PRODUCT_ANALYTICS_MAX_BATCH_BYTES + 1, 32),
    });

    expect(answer.status).toBe(413);
    expect(answer.body?.["reason"]).toBe("payload-too-large");
    expect(gateMock).not.toHaveBeenCalled();
  });

  test("a batch without the application identifier", async () => {
    const answer: Answer = await post({
      headers: { [SESSION_REPLAY_APP_IDENTIFIER_HEADER]: "  " },
    });

    expect(answer.status).toBe(400);
    expect(answer.body?.["reason"]).toBe("missing-app-identifier");
  });

  test("a recorder kind it does not know", async () => {
    const answer: Answer = await post({
      headers: { [SESSION_REPLAY_RECORDER_KIND_HEADER]: "flash" },
    });

    expect(answer.status).toBe(400);
    expect(answer.body?.["reason"]).toBe("unsupported-recorder-kind");
  });

  test("a native recorder without a valid app identifier", async () => {
    const answer: Answer = await post({
      headers: { [SESSION_REPLAY_RECORDER_KIND_HEADER]: "rn-view-tree" },
    });

    expect(answer.status).toBe(400);
    expect(answer.body?.["reason"]).toBe("invalid-mobile-app-identifier");
    expect(gateMock).not.toHaveBeenCalled();
  });

  test("a native recorder with one goes on to the gate", async () => {
    const answer: Answer = await post({
      headers: {
        [SESSION_REPLAY_RECORDER_KIND_HEADER]: "rn-view-tree",
        [SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER]: "com.example.shop",
      },
    });

    expect(answer.status).toBe(202);
    expect(gateMock).toHaveBeenCalledTimes(1);
  });
});

describe("the gate", () => {
  test("is asked with the application, the origin the key check resolved, the page's consent and every item", async () => {
    await post({ resolvedClientOrigin: "app://com.example.shop" });

    expect(gateMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      appIdentifier: APP_IDENTIFIER,
      origin: "app://com.example.shop",
      consentState: "Granted",
      itemCount: 3,
    });
  });

  test("falls back to the Origin header, and counts a body it cannot read as nothing", async () => {
    await post({ body: Buffer.from("not json") });

    expect(gateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "https://shop.example.com",
        consentState: "",
        itemCount: 0,
      }),
    );
  });

  test("off for the application: 204 with the reason in a header, no body", async () => {
    gateMock.mockImplementation(async (): Promise<unknown> => {
      return {
        outcome: ProductAnalyticsGateOutcome.Stop,
        reason: "product-analytics-not-enabled",
      };
    });

    const answer: Answer = await post();

    expect(answer.status).toBe(204);
    expect(answer.res.ended).toBe(true);
    expect(answer.res.headers["x-oneuptime-replay-reason"]).toBe(
      "product-analytics-not-enabled",
    );
    expect(answer.body).toBeNull();
    expect(addJobMock).not.toHaveBeenCalled();
  });

  test.each([
    ["origin-not-allowed", ProductAnalyticsGateOutcome.OriginRefused, 403],
    ["consent-required", ProductAnalyticsGateOutcome.Refused, 409],
  ])(
    "%s answers %s with %d",
    async (
      reason: string,
      outcome: ProductAnalyticsGateOutcome,
      status: number,
    ) => {
      gateMock.mockImplementation(async (): Promise<unknown> => {
        return { outcome: outcome, reason: reason };
      });

      const answer: Answer = await post();

      expect(answer.status).toBe(status);
      expect(answer.body).toEqual({ reason: reason });
      expect(claimMock).not.toHaveBeenCalled();
      expect(addJobMock).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["rate-limited", ProductAnalyticsGateOutcome.RateLimited, 429, 12],
    [
      "rate-counter-unavailable",
      ProductAnalyticsGateOutcome.Unavailable,
      503,
      30,
    ],
  ])(
    "%s answers %s with %d and when to try again",
    async (
      reason: string,
      outcome: ProductAnalyticsGateOutcome,
      status: number,
      retryAfterSeconds: number,
    ) => {
      gateMock.mockImplementation(async (): Promise<unknown> => {
        return {
          outcome: outcome,
          reason: reason,
          retryAfterSeconds: retryAfterSeconds,
        };
      });

      const answer: Answer = await post();

      expect(answer.status).toBe(status);
      expect(answer.res.headers["Retry-After"]).toBe(String(retryAfterSeconds));
      expect(answer.body).toEqual({
        reason: reason,
        retryAfterSeconds: retryAfterSeconds,
      });
    },
  );
});

describe("after the gate", () => {
  test("a batch the parser refuses is a 400 with the parser's reason, and claims nothing", async () => {
    const answer: Answer = await post({
      body: toBody(buildBatch({ batchId: "not-an-id" })),
    });

    expect(answer.status).toBe(400);
    expect(answer.body?.["reason"]).toBe("invalid-batch-id");
    expect(claimMock).not.toHaveBeenCalled();
  });

  test("an accepted batch is claimed, queued, then answered 202", async () => {
    const order: Array<string> = [];

    claimMock.mockImplementation(async (): Promise<string> => {
      order.push("claim");
      return "claimed";
    });
    addJobMock.mockImplementation(async (): Promise<void> => {
      order.push("queue");
    });
    sendJsonMock.mockImplementation((): void => {
      order.push("answer");
    });

    const answer: Answer = await post();

    sendJsonMock.mockReset();

    expect(answer.status).toBe(202);
    expect(answer.body).toEqual({ reason: "accepted" });
    expect(order).toEqual(["claim", "queue", "answer"]);
    expect(claimMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      batchId: BATCH_ID,
    });

    const jobInput: {
      projectId: ObjectID;
      batch: { batchId: string; events: Array<unknown> };
    } = buildJobMock.mock.calls[0]![0] as {
      projectId: ObjectID;
      batch: { batchId: string; events: Array<unknown> };
    };

    expect(jobInput.projectId).toBe(PROJECT_ID);
    expect(jobInput.batch.batchId).toBe(BATCH_ID);
    expect(jobInput.batch.events).toHaveLength(2);
    expect(addJobMock).toHaveBeenCalledWith({ job: jobInput });
  });

  test("a resend of a batch already claimed is answered 202 and not queued again", async () => {
    claimMock.mockImplementation(async (): Promise<string> => {
      return "duplicate";
    });

    const answer: Answer = await post();

    expect(answer.status).toBe(202);
    expect(answer.body).toEqual({ reason: "duplicate" });
    expect(addJobMock).not.toHaveBeenCalled();
  });

  test("a claim that cannot be made is a 503 to retry", async () => {
    claimMock.mockImplementation(async (): Promise<string> => {
      return "unavailable";
    });

    const answer: Answer = await post();

    expect(answer.status).toBe(503);
    expect(answer.res.headers["Retry-After"]).toBe("30");
    expect(answer.body).toEqual({
      reason: "claim-unavailable",
      retryAfterSeconds: 30,
    });
    expect(addJobMock).not.toHaveBeenCalled();
  });

  test("a batch the queue does not take gives its claim back, so the resend lands", async () => {
    addJobMock.mockImplementation(async (): Promise<void> => {
      throw new Error("Redis is down");
    });

    const answer: Answer = await post();

    expect(answer.status).toBe(503);
    expect(answer.body).toEqual({
      reason: "staging-failed",
      retryAfterSeconds: 30,
    });
    expect(releaseMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      batchId: BATCH_ID,
    });
  });

  test("an unexpected failure goes to the error handler", async () => {
    gateMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("boom");
    });

    const answer: Answer = await post();

    expect((answer.nextError as Error).message).toBe("boom");
  });
});

describe("the country", () => {
  async function countryFor(data: {
    header?: string;
    captureGeo?: boolean;
  }): Promise<string> {
    accept({ captureGeo: data.captureGeo ?? true });

    await post({
      headers: data.header !== undefined ? { "cf-ipcountry": data.header } : {},
    });

    return (buildJobMock.mock.calls[0]![0] as { countryCode: string })
      .countryCode;
  }

  test("is the trusted proxy's two letters, upper-cased", async () => {
    expect(await countryFor({ header: " de " })).toBe("DE");
  });

  test.each(["XX", "T1", "Germany", "D", ""])(
    "is left out for %p",
    async (header: string) => {
      expect(await countryFor({ header: header })).toBe("");
    },
  );

  test("is left out when the application does not capture it", async () => {
    expect(await countryFor({ header: "DE", captureGeo: false })).toBe("");
  });

  test("is left out when the instance trusts no proxy header", async () => {
    trustedGeoHeader = "";

    expect(await countryFor({ header: "DE" })).toBe("");
  });
});
