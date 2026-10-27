import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /api/notification/custom-channel/send (CustomChannelSendAPI): where
 * core hands the Enterprise Edition every request for a custom channel
 * (CustomNotificationChannelDeliveryService).
 *
 *   - only OneUptime's own services reach it: the cluster key, in a header,
 *     checked before anything is read (ClusterKeyAuthorization);
 *   - a request without a channel id, with one that is not an id, or
 *     without an event is refused before the sender is asked;
 *   - the sender is handed the channel and log row as ids, the event, the
 *     payload, and whether it is a test - and nothing else of the request;
 *   - the answer says how it went, delivered or not: ok, the status the
 *     channel's service answered (or null) and the words for it - which is
 *     what core reads back.
 *
 * Served over HTTP on an Express app as the App mounts it (at /api, with the
 * App's error handler), so the real middleware runs. The sender is replaced:
 * its own suite (CustomChannelSender.test.ts) covers what it does.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

// No Valkey here: the wrong-key count fails open without it, as it does in the App.
jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
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
    EXTERNAL_FAULT: {},
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import CustomChannelSendAPI, {
  CUSTOM_CHANNEL_SEND_PATH,
} from "../../../Server/CustomNotificationChannels/API/CustomChannelSendAPI";
import CustomChannelSender from "../../../Server/CustomNotificationChannels/CustomChannelSender";
import { EnterpriseServerModuleShape } from "Common/Server/Enterprise/EnterpriseServerModule";
import ClusterKeyAuthorization, {
  CLUSTER_KEY_IN_URL_MESSAGE,
  CLUSTER_KEY_NOT_FOUND_MESSAGE,
  INVALID_CLUSTER_KEY_MESSAGE,
  SHIPPED_CLUSTER_KEY_MESSAGE,
} from "Common/Server/Middleware/ClusterKeyAuthorization";
import CustomNotificationChannelDeliveryService, {
  CustomChannelDeliveryResult,
} from "Common/Server/Services/CustomNotificationChannelDeliveryService";
import BlockedProjectNotifications from "Common/Server/Utils/Notification/BlockedProjectNotifications";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
} from "Common/Server/Utils/Express";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/Utils/API";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import http from "http";
import { AddressInfo } from "net";

const SEND_PATH: string = `/api${CUSTOM_CHANNEL_SEND_PATH}`;

const CHANNEL_ID: string = "c4a20000-0000-4000-8000-000000000001";
const TIMELINE_ID: string = "c4a20000-0000-4000-8000-000000000002";
const PROJECT_ID: string = "c4a20000-0000-4000-8000-000000000003";

const PAYLOAD: JSONObject = {
  version: 1,
  event: "on-call.incident.created",
  title: "New Incident INC-42",
};

interface Answer {
  status: number;
  body: JSONObject;
}

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
}

let server: http.Server;
let baseUrl: string;
let sender: jest.SpyInstance;

const DELIVERED: CustomChannelDeliveryResult = {
  ok: true,
  statusCode: 202,
  message: "Sent to CorpoApp (HTTP 202).",
};

async function post(data: {
  body: unknown;
  headers?: Dictionary<string> | undefined;
  path?: string | undefined;
}): Promise<Answer> {
  const response: globalThis.Response = await fetch(
    `${baseUrl}${data.path || SEND_PATH}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(data.headers || {}),
      },
      body: JSON.stringify(data.body),
    },
  );

  const text: string = await response.text();

  return {
    status: response.status,
    body: text ? (JSON.parse(text) as JSONObject) : {},
  };
}

// A request as OneUptime's own services send it: with the cluster key.
async function postFromCore(body: unknown): Promise<Answer> {
  return await post({
    body: body,
    headers: ClusterKeyAuthorization.getClusterKeyHeaders(),
  });
}

// What the sender was handed, the one time it was asked.
function handed(): Record<string, unknown> {
  expect(sender).toHaveBeenCalledTimes(1);

  return sender.mock.calls[0]![0] as Record<string, unknown>;
}

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson());
  // How the App mounts every Enterprise API router (BaseAPI): at /api.
  app.use("/api", CustomChannelSendAPI);
  app.use(expressErrorHandler);

  server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  setTestBillingEnabled(false);
  installFakeEnterpriseModule();
  sender = jest.spyOn(CustomChannelSender, "send").mockResolvedValue(DELIVERED);
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the router", () => {
  const layers: Array<RouteLayer> = (
    CustomChannelSendAPI as unknown as { stack: Array<RouteLayer> }
  ).stack;

  test("holds the one route, a POST, at the path core posts to", () => {
    expect(CUSTOM_CHANNEL_SEND_PATH).toBe("/notification/custom-channel/send");
    expect(
      layers.map((layer: RouteLayer): [string, Record<string, boolean>] => {
        return [layer.route!.path, layer.route!.methods];
      }),
    ).toEqual([[CUSTOM_CHANNEL_SEND_PATH, { post: true }]]);
  });

  test("holds routes only, so mounting it at /api shadows none of core's", () => {
    expect(
      EnterpriseServerModuleShape.findLayersWithoutRoute(CustomChannelSendAPI),
    ).toEqual([]);
  });

  test("asks for the cluster key before anything else, and has nothing between it and the handler", () => {
    const stack: Array<{ handle: unknown }> = layers[0]!.route!.stack;

    expect(stack).toHaveLength(2);
    expect(stack[0]!.handle).toBe(
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    );
  });
});

describe("only OneUptime's own services reach it", () => {
  const BODY: JSONObject = {
    customNotificationChannelId: CHANNEL_ID,
    eventType: "on-call.incident.created",
    payload: PAYLOAD,
  };

  test("no cluster key: refused, and the sender is never asked", async () => {
    const answer: Answer = await post({ body: BODY });

    expect(answer).toEqual({
      status: 400,
      body: { message: CLUSTER_KEY_NOT_FOUND_MESSAGE },
    });
    expect(sender).not.toHaveBeenCalled();
  });

  test("a wrong cluster key: refused", async () => {
    const answer: Answer = await post({
      body: BODY,
      headers: { clusterkey: "not-this-installation's-key" },
    });

    expect(answer).toEqual({
      status: 400,
      body: { message: INVALID_CLUSTER_KEY_MESSAGE },
    });
    expect(sender).not.toHaveBeenCalled();
  });

  test("a cluster key this repository ships: refused, whatever this installation's key is", async () => {
    const answer: Answer = await post({
      body: BODY,
      headers: { clusterkey: "secret" },
    });

    expect(answer).toEqual({
      status: 400,
      body: { message: SHIPPED_CLUSTER_KEY_MESSAGE },
    });
    expect(sender).not.toHaveBeenCalled();
  });

  test("the right key in the URL: refused, even with it in the header too", async () => {
    const answer: Answer = await post({
      body: BODY,
      headers: ClusterKeyAuthorization.getClusterKeyHeaders(),
      path: `${SEND_PATH}?clusterKey=${ClusterKeyAuthorization.getClusterKey()}`,
    });

    expect(answer).toEqual({
      status: 400,
      body: { message: CLUSTER_KEY_IN_URL_MESSAGE },
    });
    expect(sender).not.toHaveBeenCalled();
  });

  test.each(["clusterkey", "x-clusterkey"])(
    "the right key in the %s header: answered",
    async (header: string) => {
      const answer: Answer = await post({
        body: BODY,
        headers: { [header]: ClusterKeyAuthorization.getClusterKey() },
      });

      expect(answer.status).toBe(200);
      expect(sender).toHaveBeenCalledTimes(1);
    },
  );
});

describe("a request the sender is never asked about", () => {
  test.each([
    ["no channel id", { eventType: "test" }],
    [
      "an empty channel id",
      { customNotificationChannelId: "", eventType: "test" },
    ],
    [
      "a channel id that is not an id",
      { customNotificationChannelId: "corpo-app", eventType: "test" },
    ],
    [
      "a channel id that is a number",
      { customNotificationChannelId: 42, eventType: "test" },
    ],
  ])(
    "%s: 400, the channel id is required",
    async (_label: string, body: JSONObject) => {
      const answer: Answer = await postFromCore(body);

      expect(answer).toEqual({
        status: 400,
        body: { error: "`customNotificationChannelId` is required" },
      });
      expect(sender).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["no event", { customNotificationChannelId: CHANNEL_ID }],
    [
      "an empty event",
      { customNotificationChannelId: CHANNEL_ID, eventType: "" },
    ],
  ])(
    "%s: 400, the event is required",
    async (_label: string, body: JSONObject) => {
      const answer: Answer = await postFromCore(body);

      expect(answer).toEqual({
        status: 400,
        body: { error: "`eventType` is required" },
      });
      expect(sender).not.toHaveBeenCalled();
    },
  );
});

describe("what the sender is handed", () => {
  test("the channel and the log row as ids, the event, the payload, and that it is not a test - nothing else of the request", async () => {
    await postFromCore({
      customNotificationChannelId: CHANNEL_ID,
      eventType: "on-call.incident.created",
      payload: PAYLOAD,
      isTest: false,
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
      webhookUrl: "https://attacker.example.com/hook",
      secret: "chosen-by-the-caller",
    });

    const input: Record<string, unknown> = handed();

    expect(Object.keys(input).sort()).toEqual(
      [
        "customNotificationChannelId",
        "eventType",
        "isTest",
        "payload",
        "userOnCallLogTimelineId",
      ].sort(),
    );
    expect(input["customNotificationChannelId"]).toBeInstanceOf(ObjectID);
    expect(String(input["customNotificationChannelId"])).toBe(CHANNEL_ID);
    expect(input["eventType"]).toBe("on-call.incident.created");
    expect(input["payload"]).toEqual(PAYLOAD);
    expect(input["isTest"]).toBe(false);
    expect(input["userOnCallLogTimelineId"]).toBeInstanceOf(ObjectID);
    expect(String(input["userOnCallLogTimelineId"])).toBe(TIMELINE_ID);
  });

  test("a test is a test only when it says so with true", async () => {
    for (const [isTest, expected] of [
      [true, true],
      ["true", false],
      [1, false],
      [undefined, false],
    ] as Array<[unknown, boolean]>) {
      sender.mockClear();

      await postFromCore({
        customNotificationChannelId: CHANNEL_ID,
        eventType: "test",
        payload: {},
        isTest: isTest,
      });

      expect({ isTest, handed: handed()["isTest"] }).toEqual({
        isTest,
        handed: expected,
      });
    }
  });

  test.each([
    ["no log row", undefined],
    ["an empty log row", ""],
    ["a log row that is not an id", "row-1"],
  ])(
    "%s: the sender is given none, and still sends",
    async (_label: string, userOnCallLogTimelineId: string | undefined) => {
      const answer: Answer = await postFromCore({
        customNotificationChannelId: CHANNEL_ID,
        eventType: "test",
        payload: {},
        userOnCallLogTimelineId: userOnCallLogTimelineId,
      });

      expect(answer.status).toBe(200);
      expect(handed()["userOnCallLogTimelineId"]).toBeUndefined();
    },
  );

  test("no payload is an empty one", async () => {
    await postFromCore({
      customNotificationChannelId: CHANNEL_ID,
      eventType: "test",
    });

    expect(handed()["payload"]).toEqual({});
  });
});

describe("the answer", () => {
  test("delivered: ok, the status the channel's service answered, and the words for it", async () => {
    const answer: Answer = await postFromCore({
      customNotificationChannelId: CHANNEL_ID,
      eventType: "on-call.incident.created",
      payload: PAYLOAD,
    });

    expect(answer).toEqual({
      status: 200,
      body: {
        ok: true,
        statusCode: 202,
        message: "Sent to CorpoApp (HTTP 202).",
      },
    });
  });

  test("not delivered is still a 200: the answer says how it went, so a test can show it", async () => {
    sender.mockResolvedValue({
      ok: false,
      statusCode: 503,
      message: "Not delivered: CorpoApp answered HTTP 503 (tried 3 times).",
    });

    const answer: Answer = await postFromCore({
      customNotificationChannelId: CHANNEL_ID,
      eventType: "on-call.incident.created",
      payload: PAYLOAD,
    });

    expect(answer).toEqual({
      status: 200,
      body: {
        ok: false,
        statusCode: 503,
        message: "Not delivered: CorpoApp answered HTTP 503 (tried 3 times).",
      },
    });
  });

  test("no status from the channel's service is null, never left out", async () => {
    sender.mockResolvedValue({
      ok: false,
      message: "Not delivered: CorpoApp could not be reached (tried 3 times).",
    });

    const answer: Answer = await postFromCore({
      customNotificationChannelId: CHANNEL_ID,
      eventType: "test",
      payload: {},
    });

    expect(answer.body).toEqual({
      ok: false,
      statusCode: null,
      message: "Not delivered: CorpoApp could not be reached (tried 3 times).",
    });
  });

  test("a sender that throws is a server error, not an answer", async () => {
    sender.mockRejectedValue(new Error("Postgres is down"));

    const answer: Answer = await postFromCore({
      customNotificationChannelId: CHANNEL_ID,
      eventType: "test",
      payload: {},
    });

    expect(answer.status).toBe(500);
    expect(answer.body["ok"]).toBeUndefined();
  });
});

describe("core's request, end to end", () => {
  /*
   * Core's delivery service builds the request; this hands it, as it is, to
   * the route over HTTP, and core reads the answer back. So the path, the
   * cluster key, the body's field names and the answer's are one contract
   * between the two editions.
   */
  let forwarded: Array<{ path: string; body: JSONObject }> = [];

  beforeEach(() => {
    forwarded = [];

    jest
      .spyOn(BlockedProjectNotifications, "getRefusal")
      .mockResolvedValue(null);
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: { toString: () => string };
      data: JSONObject;
      headers: Dictionary<string>;
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const path: string = new globalThis.URL(options.url.toString()).pathname;

      forwarded.push({ path, body: options.data });

      const answer: Answer = await post({
        body: options.data,
        headers: options.headers,
        path: path,
      });

      return answer.status === 200
        ? new HTTPResponse<JSONObject>(200, answer.body, {})
        : new HTTPErrorResponse(answer.status, answer.body, {});
    }) as never);
  });

  test("a page: core's request reaches the sender as core named it, and core reads the answer back", async () => {
    const result: CustomChannelDeliveryResult =
      await CustomNotificationChannelDeliveryService.send({
        customNotificationChannelId: new ObjectID(CHANNEL_ID),
        eventType: "on-call.incident.created",
        payload: PAYLOAD,
        projectId: new ObjectID(PROJECT_ID),
        userOnCallLogTimelineId: new ObjectID(TIMELINE_ID),
      });

    expect(
      forwarded.map((request: { path: string }): string => {
        return request.path;
      }),
    ).toEqual([SEND_PATH]);
    expect(String(handed()["customNotificationChannelId"])).toBe(CHANNEL_ID);
    expect(String(handed()["userOnCallLogTimelineId"])).toBe(TIMELINE_ID);
    expect(handed()["payload"]).toEqual(PAYLOAD);
    expect(handed()["isTest"]).toBe(false);
    expect(result).toEqual(DELIVERED);
  });

  test("a test: the sender is told it is one", async () => {
    await CustomNotificationChannelDeliveryService.send({
      customNotificationChannelId: new ObjectID(CHANNEL_ID),
      eventType: "test",
      payload: {},
      isTest: true,
    });

    expect(handed()["isTest"]).toBe(true);
    expect(handed()["userOnCallLogTimelineId"]).toBeUndefined();
  });

  test("undelivered, with no status: core reads it as not ok, with no status", async () => {
    sender.mockResolvedValue({
      ok: false,
      message: "Not delivered: CorpoApp could not be reached (tried 3 times).",
    });

    const result: CustomChannelDeliveryResult =
      await CustomNotificationChannelDeliveryService.send({
        customNotificationChannelId: new ObjectID(CHANNEL_ID),
        eventType: "test",
        payload: {},
      });

    expect(result).toEqual({
      ok: false,
      statusCode: undefined,
      message: "Not delivered: CorpoApp could not be reached (tried 3 times).",
    });
  });

  test("while custom channels are not active, core asks nothing of the route at all", async () => {
    uninstallEnterpriseModule();

    const result: CustomChannelDeliveryResult =
      await CustomNotificationChannelDeliveryService.send({
        customNotificationChannelId: new ObjectID(CHANNEL_ID),
        eventType: "test",
        payload: {},
      });

    expect(result.ok).toBe(false);
    expect(forwarded).toEqual([]);
    expect(sender).not.toHaveBeenCalled();
  });
});
