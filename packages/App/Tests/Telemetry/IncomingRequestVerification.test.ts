import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createHash } from "crypto";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * AN INCOMING REQUEST MONITOR'S URL ANSWERS THE VERIFICATION HANDSHAKES OF
 * AZURE EVENT GRID, SLACK, MICROSOFT GRAPH, OKTA AND CLOUDEVENTS SENDERS.
 *
 * https://github.com/OneUptime/oneuptime/issues/8429
 *
 * Each of these services delivers nothing to an endpoint until it answers a
 * check in the way the service's protocol sets, and the endpoint answered
 * every request with {}: none of them could be pointed at a monitor (Event
 * Grid could, by a link someone had to open within 10 minutes). Now:
 *
 *   - each handshake is answered as its protocol sets, echoing only the
 *     code, challenge, token or origin - and only one a service would mint;
 *   - only for a monitor's key: a new monitor's key is looked up for it, a
 *     key that is no monitor's gets {}, as every request does;
 *   - only once the project's incoming request secret requirement lets the
 *     request through: without the secret it is refused 401, as any request;
 *   - the handshake still reaches the monitor, as it always did - but for the
 *     CloudEvents OPTIONS, which is answered and nothing more;
 *   - a browser's CORS preflight is answered by the CORS middleware, as
 *     before.
 *
 * The real Incoming Request router over HTTP, behind the CORS middleware and
 * the body parsers StartServer runs for every route; only the queue, the
 * arrival store, the key cache, the monitor lookup, the project's policy and
 * the monitor's secret record are stood in for.
 */

const MONITOR_KEY: string = "8429aaaa-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const NEW_MONITOR_KEY: string = "8429bbbb-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const NO_MONITOR_KEY: string = "8429cccc-17c4-4b4f-9a3b-3c6ff1a1a2ee";

const MONITOR_ID: string = "b0b0b0b0-0000-4000-8000-0000000000b0";
const PROJECT_ID: string = "aaaaaaaa-0000-4000-8000-00000000000a";
const PROJECT_SECRET: string = "4f1c2a9be0d34c6f8a7b5e3d2c1b0a99";

const EVENT_GRID_CODE: string = "512d38b6-c7b8-40c8-89fe-f46f9e9622b6";
const SLACK_CHALLENGE: string =
  "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P";
const GRAPH_TOKEN: string =
  "Validation: Testing client application reachability for subscription Request-Id: 2c4a4c6c-2fd7-4cfb-9a4b-7cd9b4c5e3f1";
const OKTA_CHALLENGE: string = "6NWv4uK3PE5xL3xPf7JpQ1SxRyUuN0bjEfVYRzWK";

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function require_(modulePath: string): AnyModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(modulePath);
}

interface Policy {
  isRequired: boolean;
  secrets: Array<{ secretId: string; secretHash: string }>;
}

const NOT_REQUIRED: Policy = { isRequired: false, secrets: [] };

const REQUIRED: Policy = {
  isRequired: true,
  secrets: [
    {
      secretId: "5ec2e700-0000-4000-8000-000000000001",
      secretHash: createHash("sha256")
        .update(PROJECT_SECRET, "utf8")
        .digest("hex"),
    },
  ],
};

let http: Server;
let origin: string;
let policy: Policy = NOT_REQUIRED;
let lookups: Array<string> = [];
const queued: Array<JSONObject> = [];

beforeAll(async () => {
  http = createServer();

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  jest.isolateModules(() => {
    const TelemetryQueueService: AnyModule = require_(
      "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
    ).default;
    const IncomingRequestReceivedAtStore: AnyModule = require_(
      "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore",
    ).default;
    const MonitorSecretKeyCache: AnyModule = require_(
      "Common/Server/Utils/Monitor/MonitorSecretKeyCache",
    ).default;
    const MonitorService: AnyModule = require_(
      "Common/Server/Services/MonitorService",
    ).default;
    const IncomingRequestSecretPolicy: AnyModule = require_(
      "Common/Server/Utils/Monitor/IncomingRequestSecretPolicy",
    ).default;
    const IncomingRequestSecretActivity: AnyModule = require_(
      "Common/Server/Utils/Monitor/IncomingRequestSecretActivity",
    ).default;
    const ObjectID: AnyModule = require_("Common/Types/ObjectID").default;

    jest
      .spyOn(TelemetryQueueService, "addIncomingRequestIngestJob")
      .mockImplementation((async (job: JSONObject) => {
        queued.push(job);
      }) as never);
    jest
      .spyOn(IncomingRequestReceivedAtStore, "advanceIfTracked")
      .mockImplementation((async () => {}) as never);
    jest
      .spyOn(IncomingRequestReceivedAtStore, "isTracked")
      .mockImplementation((async () => {
        return false;
      }) as never);

    // Only the monitor's key is kept: a new monitor's is not, yet.
    jest
      .spyOn(MonitorSecretKeyCache, "getMonitor")
      .mockImplementation((async (data: { secretKey: string }) => {
        return data.secretKey === MONITOR_KEY
          ? {
              monitorId: new ObjectID(MONITOR_ID),
              projectId: new ObjectID(PROJECT_ID),
            }
          : null;
      }) as never);
    jest
      .spyOn(MonitorSecretKeyCache, "setMonitor")
      .mockImplementation((async () => {}) as never);

    /*
     * The database knows the new monitor's key, and no made-up one: the key
     * is found by its lookup hash (#9012), the lookup stubbed here.
     */
    jest
      .spyOn(MonitorService, "findOneByPresentedKey")
      .mockImplementation((async (data: {
        presentedKey: { toString: () => string };
      }) => {
        const key: string = data.presentedKey.toString();
        lookups.push(key);

        return key === NEW_MONITOR_KEY
          ? {
              _id: MONITOR_ID,
              projectId: new ObjectID(PROJECT_ID),
              isArchived: false,
              disableActiveMonitoring: false,
              disableActiveMonitoringBecauseOfManualIncident: false,
              disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
            }
          : null;
      }) as never);

    jest
      .spyOn(IncomingRequestSecretPolicy, "getPolicy")
      .mockImplementation((async () => {
        return policy;
      }) as never);
    jest
      .spyOn(IncomingRequestSecretActivity, "record")
      .mockImplementation((async () => {}) as never);

    const Express: AnyModule = require_("Common/Server/Utils/Express");
    const Response: AnyModule = require_(
      "Common/Server/Utils/Response",
    ).default;
    const CorsMiddleware: AnyModule = require_(
      "Common/Server/Utils/CorsMiddleware",
    ).default;
    const app: AnyModule = Express.createExpressApp();
    const route: AnyModule = require_(
      "../../FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest",
    );

    // As StartServer, for every route: CORS, then JSON, then forms.
    app.use(CorsMiddleware);
    app.use(Express.ExpressJson({ limit: "50mb" }));
    app.use(Express.ExpressUrlEncoded({ extended: true, limit: "50mb" }));
    app.use(["/incoming-request-ingest", "/"], route.default);

    // As StartServer answers a refusal: its status, with its message.
    app.use(
      (err: AnyModule, req: AnyModule, res: AnyModule, _next: AnyModule) => {
        Response.sendErrorResponse(req, res, err);
      },
    );

    http.on("request", app);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    http.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  policy = NOT_REQUIRED;
  lookups = [];
});

interface Answer {
  status: number;
  headers: globalThis.Headers;
  text: string;
  // What reached the monitor's queue, if anything did.
  job: JSONObject | null;
}

async function call(data: {
  method: string;
  key?: string;
  path?: string;
  query?: string;
  headers?: Dictionary<string>;
  body?: string;
}): Promise<Answer> {
  const before: number = queued.length;
  const url: string = `${origin}${data.path ?? ""}/incoming-request/${data.key ?? MONITOR_KEY}${data.query ?? ""}`;

  const response: globalThis.Response = await fetch(url, {
    method: data.method,
    headers: data.headers || {},
    ...(data.body !== undefined ? { body: data.body } : {}),
  });

  const text: string = await response.text();

  // The job, when there is one, is queued before the answer.
  for (let attempt: number = 0; attempt < 20; attempt++) {
    if (queued.length > before) {
      break;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });
  }

  return {
    status: response.status,
    headers: response.headers,
    text: text,
    job: queued.length > before ? queued[before]! : null,
  };
}

const eventGridValidation: (code?: string) => string = (
  code: string = EVENT_GRID_CODE,
): string => {
  return JSON.stringify([
    {
      id: "2d1781af-3a4c-4d7c-bd0c-e34b19da4e66",
      topic:
        "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/ops/providers/Microsoft.Storage/storageAccounts/acmeprod",
      subject: "",
      data: {
        validationCode: code,
        validationUrl:
          "https://rp-eastus2.eventgrid.azure.net:553/eventsubscriptions/oneuptime/validate?id=512d38b6&t=2026-11-13T15:59:14Z&apiVersion=2018-05-01-preview&token=8YjnTyV4",
      },
      eventType: "Microsoft.EventGrid.SubscriptionValidationEvent",
      eventTime: "2026-11-13T15:59:14.000Z",
      metadataVersion: "1",
      dataVersion: "1",
    },
  ]);
};

const EVENT_GRID_HEADERS: Dictionary<string> = {
  "content-type": "application/json",
  "aeg-event-type": "SubscriptionValidation",
};

const slackVerification: (challenge?: string) => string = (
  challenge: string = SLACK_CHALLENGE,
): string => {
  return JSON.stringify({
    token: "Jhj5dZrVaK7ZwHHjRyZWjbDl",
    challenge: challenge,
    type: "url_verification",
  });
};

function expectSafe(answer: Answer): void {
  expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
  expect(answer.headers.get("cache-control")).toBe("no-store");
}

describe("Azure Event Grid's subscription validation (Event Grid schema)", () => {
  test("is answered with the validation code", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: EVENT_GRID_HEADERS,
      body: eventGridValidation(),
    });

    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(JSON.parse(answer.text)).toEqual({
      validationResponse: EVENT_GRID_CODE,
    });
    expectSafe(answer);
  });

  test("still reaches the monitor, as it always did", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: EVENT_GRID_HEADERS,
      body: eventGridValidation(),
    });

    expect(answer.job).not.toBeNull();
    expect(
      (
        (answer.job!["requestBody"] as Array<JSONObject>)[0]![
          "data"
        ] as JSONObject
      )["validationCode"],
    ).toBe(EVENT_GRID_CODE);
  });

  /*
   * So the monitor's summary no longer asks someone to open the validation
   * link of a subscription OneUptime has validated.
   */
  test("reaches the monitor saying OneUptime answered it", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: EVENT_GRID_HEADERS,
      body: eventGridValidation(),
    });

    expect(answer.job?.["answeredVerification"]).toBe("Azure Event Grid");
  });

  test("relayed by a probe, which answers its sender itself, reaches it saying nothing was answered", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: {
        ...EVENT_GRID_HEADERS,
        "oneuptime-probe-id": "11111111-2222-3333-4444-555555555555",
      },
      body: eventGridValidation(),
    });

    expect(answer.job).not.toBeNull();
    expect(answer.job?.["answeredVerification"]).toBeUndefined();
  });

  test("with a code no service would mint is answered as any request", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: EVENT_GRID_HEADERS,
      body: eventGridValidation('"><script>alert(1)</script>'),
    });

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({});
    expect(answer.text).not.toContain("script");
  });
});

describe("Slack's URL verification", () => {
  test("is answered with the challenge", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: slackVerification(),
    });

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({ challenge: SLACK_CHALLENGE });
    expectSafe(answer);
    expect(answer.job).not.toBeNull();
  });

  test("a challenge holding markup is never echoed", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: slackVerification("<img src=x onerror=alert(1)>"),
    });

    expect(JSON.parse(answer.text)).toEqual({});
    expect(answer.text).not.toContain("onerror");
  });
});

describe("Microsoft Graph's validation", () => {
  test("is answered with the decoded token, as text/plain", async () => {
    const answer: Answer = await call({
      method: "POST",
      query: `?validationToken=${encodeURIComponent(GRAPH_TOKEN).replace(/%20/g, "+")}`,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: "",
    });

    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(answer.text).toBe(GRAPH_TOKEN);
    expectSafe(answer);
  });

  test("is answered under the prefix a probe and the Helm chart's services use", async () => {
    const answer: Answer = await call({
      method: "POST",
      path: "/incoming-request-ingest",
      query: `?validationToken=${encodeURIComponent(GRAPH_TOKEN)}`,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: "",
    });

    expect(answer.text).toBe(GRAPH_TOKEN);
  });

  test("a token holding markup is never echoed", async () => {
    const answer: Answer = await call({
      method: "POST",
      query: `?validationToken=${encodeURIComponent("<script>alert(1)</script>")}`,
      headers: { "content-type": "text/plain" },
      body: "",
    });

    expect(answer.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(answer.text)).toEqual({});
  });

  test("a notification with a body is no validation", async () => {
    const answer: Answer = await call({
      method: "POST",
      query: `?validationToken=${encodeURIComponent(GRAPH_TOKEN)}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: [{ changeType: "created" }] }),
    });

    expect(JSON.parse(answer.text)).toEqual({});
  });
});

describe("Okta's event hook verification", () => {
  test("is answered with the challenge", async () => {
    const answer: Answer = await call({
      method: "GET",
      headers: { "x-okta-verification-challenge": OKTA_CHALLENGE },
    });

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({ verification: OKTA_CHALLENGE });
    expectSafe(answer);
    expect(answer.job?.["requestMethod"]).toBe("GET");
  });
});

describe("a CloudEvents validation, as Azure Event Grid sends it", () => {
  test("is granted, past the CORS middleware", async () => {
    const answer: Answer = await call({
      method: "OPTIONS",
      headers: { "webhook-request-origin": "eventgrid.azure.net" },
    });

    expect(answer.status).toBe(200);
    expect(answer.headers.get("webhook-allowed-origin")).toBe(
      "eventgrid.azure.net",
    );
    expect(answer.headers.get("webhook-allowed-rate")).toBe("*");
    expectSafe(answer);
  });

  test("is answered and nothing more: it is no request for the monitor", async () => {
    const answer: Answer = await call({
      method: "OPTIONS",
      headers: { "webhook-request-origin": "eventgrid.azure.net" },
    });

    expect(answer.job).toBeNull();
  });

  test("with an origin no service would send is granted nothing", async () => {
    const answer: Answer = await call({
      method: "OPTIONS",
      headers: { "webhook-request-origin": "evil.example.com, other" },
    });

    expect(answer.status).toBe(200);
    expect(answer.headers.get("webhook-allowed-origin")).toBeNull();
    expect(answer.job).toBeNull();
  });

  test("a browser's preflight is still answered by the CORS middleware", async () => {
    const answer: Answer = await call({
      method: "OPTIONS",
      headers: {
        origin: "https://shop.example.com",
        "access-control-request-method": "POST",
      },
    });

    expect(answer.status).toBe(204);
    expect(answer.headers.get("webhook-allowed-origin")).toBeNull();
    expect(answer.job).toBeNull();
  });
});

describe("only for a monitor's key", () => {
  test("a new monitor's key, kept nowhere yet, is looked up for a handshake, and answered", async () => {
    const answer: Answer = await call({
      method: "POST",
      key: NEW_MONITOR_KEY,
      headers: { "content-type": "application/json" },
      body: slackVerification(),
    });

    expect(lookups).toEqual([NEW_MONITOR_KEY]);
    expect(JSON.parse(answer.text)).toEqual({ challenge: SLACK_CHALLENGE });
  });

  test("a key that is no monitor's is answered as any request, and left to the worker", async () => {
    const answer: Answer = await call({
      method: "POST",
      key: NO_MONITOR_KEY,
      headers: { "content-type": "application/json" },
      body: slackVerification(),
    });

    expect(lookups).toEqual([NO_MONITOR_KEY]);
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({});
    expect(answer.job).not.toBeNull();
    expect(answer.job?.["answeredVerification"]).toBeUndefined();
  });

  test("a request that is no handshake costs no lookup of a key kept nowhere, as before", async () => {
    const answer: Answer = await call({
      method: "POST",
      key: NEW_MONITOR_KEY,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge: SLACK_CHALLENGE, type: "message" }),
    });

    expect(lookups).toEqual([]);
    expect(JSON.parse(answer.text)).toEqual({});
  });
});

describe("a project that requires an incoming request secret", () => {
  beforeEach(() => {
    policy = REQUIRED;
  });

  test("refuses a handshake without the secret, 401, as any request, and keeps nothing", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: slackVerification(),
    });

    expect(answer.status).toBe(401);
    expect(answer.text).not.toContain(SLACK_CHALLENGE);
    expect(answer.job).toBeNull();
  });

  test("refuses a CloudEvents validation without the secret", async () => {
    const answer: Answer = await call({
      method: "OPTIONS",
      headers: { "webhook-request-origin": "eventgrid.azure.net" },
    });

    expect(answer.status).toBe(401);
    expect(answer.headers.get("webhook-allowed-origin")).toBeNull();
  });

  test("answers a handshake that sends the secret", async () => {
    const answer: Answer = await call({
      method: "GET",
      headers: {
        "x-okta-verification-challenge": OKTA_CHALLENGE,
        "x-oneuptime-secret": PROJECT_SECRET,
      },
    });

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({ verification: OKTA_CHALLENGE });
    expect(JSON.stringify(answer.job)).not.toContain(PROJECT_SECRET);
  });

  test("answers one that sends it as a bearer token", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: {
        ...EVENT_GRID_HEADERS,
        authorization: `Bearer ${PROJECT_SECRET}`,
      },
      body: eventGridValidation(),
    });

    expect(JSON.parse(answer.text)).toEqual({
      validationResponse: EVENT_GRID_CODE,
    });
  });
});

describe("any other request", () => {
  test("is answered {} at once, as it always was", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "healthy" }),
    });

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({});
    expect(answer.job?.["requestBody"]).toEqual({ status: "healthy" });
    expect(answer.job?.["answeredVerification"]).toBeUndefined();
  });
});
