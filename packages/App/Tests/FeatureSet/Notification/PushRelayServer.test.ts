import type GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import type PushNotificationService from "Common/Server/Services/PushNotificationService";
import type { RelayPushReceiptsResult } from "Common/Server/Services/PushNotificationService";
import type PushNotificationLogService from "Common/Server/Services/PushNotificationLogService";
import type UserPushService from "Common/Server/Services/UserPushService";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import type { expressErrorHandler } from "Common/Server/Utils/StartServer";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import API from "Common/Utils/API";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import {
  ClientRequest,
  createServer,
  IncomingMessage,
  request as httpRequest,
  Server,
} from "http";
import { AddressInfo } from "net";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * The push relay (App/FeatureSet/Notification/API/PushRelay.ts) sends what
 * another server asks it to with this server's EXPO_ACCESS_TOKEN, and reads
 * those pushes' receipts with it. It is OneUptime's cloud's service to
 * self-hosted servers, which send their pages through it by default
 * (PUSH_NOTIFICATION_RELAY_URL).
 *
 * The rule these tests hold: a server answers the relay's routes only when
 * it relays for other servers - OneUptime's cloud (BILLING_ENABLED), or a
 * server whose operator set PUSH_NOTIFICATION_RELAY_SERVER_ENABLED to true.
 * An EXPO_ACCESS_TOKEN given to a server for its own pushes does not make
 * it a relay, and every other server answers 404 before it reads anything.
 *
 * Each server here is a fresh copy of the product, loaded with the
 * environment it names: the real EnvironmentConfig reads it, the real
 * PushNotificationService and relay router act on it, over real HTTP behind
 * the real JSON parser and error handler, mounted where the Notification
 * feature set mounts it. Only Expo is stood in for.
 */

const RELAY_MOUNTS: Array<string> = [
  "/api/notification/push-relay",
  "/push-relay",
];

const PHONE_TOKEN: string = "ExponentPushToken[relay-server-phone-001]";
const RECEIPT_ID: string = "6e3c1a2b-4d5f-4a6b-9c7d-8e9f0a1b2c3d";
const AN_EXPO_ACCESS_TOKEN: string = "expo-access-token-of-this-server";

const NOT_SERVED: JSONObject = {
  message: "This server does not relay push notifications for other servers.",
};

const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000a71",
);

// What a self-hosted server posts to the relay for one page (sendViaRelay).
function page(token: string = PHONE_TOKEN): JSONObject {
  return {
    to: token,
    title: "Incident #7: Checkout is down",
    body: "A new incident has been created.",
    data: {},
    sound: "default",
    priority: "high",
    channelId: "oncall_high",
  };
}

/*
 * What the relay hands Expo and what Expo answers, as expo-server-sdk types
 * them. The SDK is Common's dependency, not App's, so each server's Expo
 * client is reached through its own service.
 */
interface ExpoPushMessage {
  to: string | Array<string>;
  [key: string]: unknown;
}

interface ExpoClient {
  sendPushNotificationsAsync: (
    messages: Array<ExpoPushMessage>,
  ) => Promise<Array<JSONObject>>;
  getPushNotificationReceiptsAsync: (
    ids: Array<string>,
  ) => Promise<{ [id: string]: JSONObject }>;
}

/*
 * The settings a server is started with. undefined: not in its
 * environment at all.
 */
interface ServerEnvironment {
  BILLING_ENABLED?: string | undefined;
  EXPO_ACCESS_TOKEN?: string | undefined;
  PUSH_NOTIFICATION_RELAY_SERVER_ENABLED?: string | undefined;
  PUSH_NOTIFICATION_RELAY_URL?: string | undefined;
}

const ENVIRONMENT_KEYS: Array<keyof ServerEnvironment> = [
  "BILLING_ENABLED",
  "EXPO_ACCESS_TOKEN",
  "PUSH_NOTIFICATION_RELAY_SERVER_ENABLED",
  "PUSH_NOTIFICATION_RELAY_URL",
];

interface LoadedServer {
  PushNotificationService: typeof PushNotificationService;
  // Its switch for push on the whole server (3207bef20f), read before a send.
  GlobalConfigService: typeof GlobalConfigService;
  UserPushService: typeof UserPushService;
  PushNotificationLogService: typeof PushNotificationLogService;
  router: ExpressRouter;
  /*
   * Its own error handler: it answers an Exception of its own copy of the
   * product with that exception's status, as the server does.
   */
  errorHandler: typeof expressErrorHandler;
}

// A fresh copy of the product, started with exactly this environment.
function loadServer(environment: ServerEnvironment): LoadedServer {
  const saved: Map<string, string | undefined> = new Map<
    string,
    string | undefined
  >();

  for (const key of ENVIRONMENT_KEYS) {
    saved.set(key, process.env[key]);

    const value: string | undefined = environment[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  let loaded: LoadedServer | null = null;

  try {
    jest.isolateModules(() => {
      loaded = {
        PushNotificationService:
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          require("Common/Server/Services/PushNotificationService").default,
        GlobalConfigService:
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          require("Common/Server/Services/GlobalConfigService").default,
        UserPushService:
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          require("Common/Server/Services/UserPushService").default,
        PushNotificationLogService:
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          require("Common/Server/Services/PushNotificationLogService").default,
        router:
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          require("../../../FeatureSet/Notification/API/PushRelay").default,
        errorHandler:
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          require("Common/Server/Utils/StartServer").expressErrorHandler,
      };
    });
  } finally {
    for (const [key, value] of saved.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  return loaded!;
}

async function listen(app: ExpressApplication): Promise<Server> {
  const server: Server = createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return server;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
}

/*
 * A server of the product, listening, its relay router mounted where the
 * Notification feature set mounts it (both addresses), and what its Expo
 * client was asked.
 */
interface RunningServer {
  loaded: LoadedServer;
  origin: string;
  http: Server;
  expoSends: Array<ExpoPushMessage>;
  expoReceiptRequests: Array<Array<string>>;
}

async function startServer(
  environment: ServerEnvironment,
): Promise<RunningServer> {
  const loaded: LoadedServer = loadServer(environment);

  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson());
  app.use(RELAY_MOUNTS, loaded.router);
  app.use(loaded.errorHandler);

  const http: Server = await listen(app);

  return {
    loaded: loaded,
    origin: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    http: http,
    expoSends: [],
    expoReceiptRequests: [],
  };
}

function expoClientOf(service: typeof PushNotificationService): ExpoClient {
  return (service as unknown as { expoClient: ExpoClient }).expoClient;
}

/*
 * Stands in for Expo behind a server's own Expo client: every send and
 * every receipt request is recorded, and accepted.
 */
function watchExpo(server: RunningServer): void {
  server.expoSends.length = 0;
  server.expoReceiptRequests.length = 0;

  const client: ExpoClient = expoClientOf(
    server.loaded.PushNotificationService,
  );

  jest.spyOn(client, "sendPushNotificationsAsync").mockImplementation((async (
    messages: Array<ExpoPushMessage>,
  ) => {
    server.expoSends.push(...messages);

    return [{ status: "ok", id: RECEIPT_ID }];
  }) as never);

  jest
    .spyOn(client, "getPushNotificationReceiptsAsync")
    .mockImplementation((async (ids: Array<string>) => {
      server.expoReceiptRequests.push(ids);

      return { [RECEIPT_ID]: { status: "ok" } };
    }) as never);
}

async function post(
  url: string,
  body: JSONObject,
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
  return await API.post<JSONObject>({
    url: URL.fromString(url),
    data: body,
  });
}

const SELF_HOSTED_WITH_ITS_OWN_EXPO_TOKEN: ServerEnvironment = {
  BILLING_ENABLED: "false",
  EXPO_ACCESS_TOKEN: AN_EXPO_ACCESS_TOKEN,
};

const ONEUPTIME_CLOUD: ServerEnvironment = {
  BILLING_ENABLED: "true",
  EXPO_ACCESS_TOKEN: AN_EXPO_ACCESS_TOKEN,
};

const SERVERS_THAT_DO_NOT_RELAY: Array<[string, ServerEnvironment]> = [
  [
    "a self-hosted server with an Expo access token for its own pushes",
    SELF_HOSTED_WITH_ITS_OWN_EXPO_TOKEN,
  ],
  [
    "a self-hosted server whose BILLING_ENABLED is not set at all",
    { EXPO_ACCESS_TOKEN: AN_EXPO_ACCESS_TOKEN },
  ],
  [
    "a self-hosted server that set the switch to false",
    {
      ...SELF_HOSTED_WITH_ITS_OWN_EXPO_TOKEN,
      PUSH_NOTIFICATION_RELAY_SERVER_ENABLED: "false",
    },
  ],
  [
    "a self-hosted server whose switch says TRUE, not true",
    {
      ...SELF_HOSTED_WITH_ITS_OWN_EXPO_TOKEN,
      PUSH_NOTIFICATION_RELAY_SERVER_ENABLED: "TRUE",
    },
  ],
  [
    "a self-hosted server whose switch says yes",
    {
      ...SELF_HOSTED_WITH_ITS_OWN_EXPO_TOKEN,
      PUSH_NOTIFICATION_RELAY_SERVER_ENABLED: "yes",
    },
  ],
  [
    "a self-hosted server whose switch says 1",
    {
      ...SELF_HOSTED_WITH_ITS_OWN_EXPO_TOKEN,
      PUSH_NOTIFICATION_RELAY_SERVER_ENABLED: "1",
    },
  ],
  [
    "a self-hosted server with no Expo credentials, as most are",
    { BILLING_ENABLED: "false" },
  ],
  [
    "OneUptime's cloud with the relay turned off",
    { ...ONEUPTIME_CLOUD, PUSH_NOTIFICATION_RELAY_SERVER_ENABLED: "false" },
  ],
  [
    "OneUptime's cloud whose switch says anything but true",
    { ...ONEUPTIME_CLOUD, PUSH_NOTIFICATION_RELAY_SERVER_ENABLED: "off" },
  ],
];

describe.each(SERVERS_THAT_DO_NOT_RELAY)(
  "%s",
  (_name: string, environment: ServerEnvironment) => {
    let server: RunningServer;

    beforeAll(async () => {
      server = await startServer(environment);
    });

    afterAll(async () => {
      await close(server.http);
    });

    beforeEach(() => {
      watchExpo(server);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("is not a push relay", () => {
      expect(server.loaded.PushNotificationService.isPushRelayServer()).toBe(
        false,
      );
    });

    test.each(RELAY_MOUNTS)(
      "%s/send: answers 404 and sends nothing to Expo",
      async (mount: string) => {
        const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
          `${server.origin}${mount}/send`,
          page(),
        );

        expect(answer).toBeInstanceOf(HTTPErrorResponse);
        expect(answer.statusCode).toBe(404);
        expect(answer.jsonData).toEqual(NOT_SERVED);
        expect(server.expoSends).toEqual([]);
      },
    );

    test.each(RELAY_MOUNTS)(
      "%s/send: a critical alert is not sent either",
      async (mount: string) => {
        const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
          `${server.origin}${mount}/send`,
          {
            ...page(),
            sound: { critical: true, name: "default", volume: 1 },
            interruptionLevel: "critical",
            channelId: "oncall_critical",
          },
        );

        expect(answer.statusCode).toBe(404);
        expect(server.expoSends).toEqual([]);
      },
    );

    test.each(RELAY_MOUNTS)(
      "%s/receipts: answers 404 and asks Expo for nothing",
      async (mount: string) => {
        const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
          `${server.origin}${mount}/receipts`,
          {
            ids: [RECEIPT_ID],
          },
        );

        expect(answer.statusCode).toBe(404);
        expect(answer.jsonData).toEqual(NOT_SERVED);
        expect(server.expoReceiptRequests).toEqual([]);
      },
    );

    test("a request it could not read is answered the same 404, before it is read", async () => {
      const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
        `${server.origin}/api/notification/push-relay/send`,
        { to: "not-a-push-token" },
      );

      expect(answer.statusCode).toBe(404);
      expect(answer.jsonData).toEqual(NOT_SERVED);
    });

    test("however often it is asked: never a 429, never Expo", async () => {
      for (let request: number = 1; request <= 70; request++) {
        const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
          `${server.origin}/push-relay/send`,
          page(),
        );

        expect(answer.statusCode).toBe(404);
      }

      expect(server.expoSends).toEqual([]);
    });
  },
);

/*
 * A request written out as a client may send it - any method, the path as
 * it is put on the wire, any body - and the answer as it came back.
 */
async function rawRequest(data: {
  server: RunningServer;
  method: string;
  path: string;
  body?: string;
  contentType?: string;
}): Promise<{ statusCode: number; body: string }> {
  const port: number = (data.server.http.address() as AddressInfo).port;

  return await new Promise(
    (
      resolve: (answer: { statusCode: number; body: string }) => void,
      reject: (error: Error) => void,
    ) => {
      const request: ClientRequest = httpRequest(
        {
          host: "127.0.0.1",
          port: port,
          method: data.method,
          path: data.path,
          // A connection of its own, closed with the answer.
          agent: false,
          headers: {
            ...(data.contentType ? { "Content-Type": data.contentType } : {}),
            ...(data.body !== undefined
              ? { "Content-Length": Buffer.byteLength(data.body) }
              : {}),
          },
        },
        (response: IncomingMessage) => {
          let body: string = "";

          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            body += chunk;
          });
          response.on("end", () => {
            resolve({ statusCode: response.statusCode || 0, body: body });
          });
        },
      );

      request.on("error", reject);

      if (data.body !== undefined) {
        request.write(data.body);
      }

      request.end();
    },
  );
}

/*
 * Every way into the relay's router on a server that does not relay: any
 * method, any spelling of the path, any body. Express matches paths
 * without regard to case, and with or without a trailing slash, so each of
 * these reaches the router, where the check answers before anything else.
 */
const WAYS_INTO_THE_RELAY: Array<[string, string]> = [
  ["GET", "/api/notification/push-relay/send"],
  ["PUT", "/api/notification/push-relay/send"],
  ["PATCH", "/push-relay/send"],
  ["DELETE", "/push-relay/receipts"],
  ["POST", "/API/NOTIFICATION/PUSH-RELAY/SEND"],
  ["POST", "/Push-Relay/Send"],
  ["POST", "/push-relay/send/"],
  ["POST", "/push-relay/send?relay=true"],
  ["POST", "/push-relay/%73end"],
  ["POST", "/push-relay/send/again"],
  ["POST", "/push-relay"],
  ["POST", "/push-relay/"],
  ["POST", "/api/notification/push-relay/receipts/"],
];

describe.each([
  [
    "a self-hosted server with an Expo access token for its own pushes",
    SELF_HOSTED_WITH_ITS_OWN_EXPO_TOKEN,
  ],
  [
    "OneUptime's cloud with the relay turned off",
    { ...ONEUPTIME_CLOUD, PUSH_NOTIFICATION_RELAY_SERVER_ENABLED: "false" },
  ],
])(
  "%s, asked every other way",
  (_name: string, environment: ServerEnvironment) => {
    let server: RunningServer;

    beforeAll(async () => {
      server = await startServer(environment);
    });

    afterAll(async () => {
      await close(server.http);
    });

    beforeEach(() => {
      watchExpo(server);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test.each(WAYS_INTO_THE_RELAY)(
      "%s %s: answers 404 and sends nothing to Expo",
      async (method: string, requestPath: string) => {
        const answer: { statusCode: number; body: string } = await rawRequest({
          server: server,
          method: method,
          path: requestPath,
          body: JSON.stringify(page()),
          contentType: "application/json",
        });

        expect(answer.statusCode).toBe(404);
        expect(JSON.parse(answer.body)).toEqual(NOT_SERVED);
        expect(server.expoSends).toEqual([]);
        expect(server.expoReceiptRequests).toEqual([]);
      },
    );

    test.each([
      ["text/plain", JSON.stringify(page())],
      [
        "application/x-www-form-urlencoded",
        `to=${encodeURIComponent(PHONE_TOKEN)}&title=Incident&body=Down`,
      ],
    ])(
      "a page sent as %s: answers 404 and sends nothing to Expo",
      async (contentType: string, body: string) => {
        const answer: { statusCode: number; body: string } = await rawRequest({
          server: server,
          method: "POST",
          path: "/api/notification/push-relay/send",
          body: body,
          contentType: contentType,
        });

        expect(answer.statusCode).toBe(404);
        expect(JSON.parse(answer.body)).toEqual(NOT_SERVED);
        expect(server.expoSends).toEqual([]);
      },
    );

    test("a route added to the relay's router later answers the same 404, and never runs", async () => {
      let reached: boolean = false;

      server.loaded.router.post(
        "/added-later",
        (_req: ExpressRequest, res: ExpressResponse) => {
          reached = true;
          res.json({ sent: true });
        },
      );

      const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
        `${server.origin}/push-relay/added-later`,
        page(),
      );

      expect(answer.statusCode).toBe(404);
      expect(answer.jsonData).toEqual(NOT_SERVED);
      expect(reached).toBe(false);
    });
  },
);

describe("OneUptime's cloud, asked the same other ways", () => {
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer(ONEUPTIME_CLOUD);
  });

  afterAll(async () => {
    await close(server.http);
  });

  beforeEach(() => {
    watchExpo(server);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The ways above that name /send or /receipts as Express reads it reach
   * those routes here: so the 404 above is the check, not a path that
   * never reached the router.
   */
  test.each([
    ["/API/NOTIFICATION/PUSH-RELAY/SEND"],
    ["/Push-Relay/Send"],
    ["/push-relay/send/"],
    ["/push-relay/send?relay=true"],
  ])("POST %s sends the page", async (requestPath: string) => {
    const answer: { statusCode: number; body: string } = await rawRequest({
      server: server,
      method: "POST",
      path: requestPath,
      body: JSON.stringify(page()),
      contentType: "application/json",
    });

    expect(answer.statusCode).toBe(200);
    expect(server.expoSends).toHaveLength(1);
  });

  test("a route added to the relay's router later is reached", async () => {
    let reached: boolean = false;

    server.loaded.router.post(
      "/added-later",
      (_req: ExpressRequest, res: ExpressResponse) => {
        reached = true;
        res.json({ sent: true });
      },
    );

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
      `${server.origin}/push-relay/added-later`,
      page(),
    );

    expect(answer.statusCode).toBe(200);
    expect(reached).toBe(true);
  });
});

const SERVERS_THAT_RELAY: Array<[string, ServerEnvironment]> = [
  ["OneUptime's cloud, as it is deployed", ONEUPTIME_CLOUD],
  [
    "OneUptime's cloud with the switch empty, as the Helm chart writes it unset",
    { ...ONEUPTIME_CLOUD, PUSH_NOTIFICATION_RELAY_SERVER_ENABLED: "" },
  ],
  [
    "OneUptime's cloud with the switch set to true",
    { ...ONEUPTIME_CLOUD, PUSH_NOTIFICATION_RELAY_SERVER_ENABLED: "true" },
  ],
  [
    "a self-hosted server whose operator turned the relay on",
    {
      ...SELF_HOSTED_WITH_ITS_OWN_EXPO_TOKEN,
      PUSH_NOTIFICATION_RELAY_SERVER_ENABLED: "true",
    },
  ],
  [
    "a self-hosted server whose switch says true with spaces around it",
    {
      ...SELF_HOSTED_WITH_ITS_OWN_EXPO_TOKEN,
      PUSH_NOTIFICATION_RELAY_SERVER_ENABLED: " true ",
    },
  ],
];

describe.each(SERVERS_THAT_RELAY)(
  "%s",
  (_name: string, environment: ServerEnvironment) => {
    let server: RunningServer;

    beforeAll(async () => {
      server = await startServer(environment);
    });

    afterAll(async () => {
      await close(server.http);
    });

    beforeEach(() => {
      watchExpo(server);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("is a push relay", () => {
      expect(server.loaded.PushNotificationService.isPushRelayServer()).toBe(
        true,
      );
    });

    test.each(RELAY_MOUNTS)(
      "%s/send: sends the page with its Expo credentials and names the receipt",
      async (mount: string) => {
        const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
          `${server.origin}${mount}/send`,
          page(),
        );

        expect(answer).toBeInstanceOf(HTTPResponse);
        expect(answer.statusCode).toBe(200);
        expect(answer.jsonData).toEqual({
          success: true,
          receiptId: RECEIPT_ID,
        });
        expect(server.expoSends).toEqual([
          {
            to: PHONE_TOKEN,
            title: "Incident #7: Checkout is down",
            body: "A new incident has been created.",
            data: {},
            sound: "default",
            priority: "high",
            channelId: "oncall_high",
          },
        ]);
      },
    );

    test.each(RELAY_MOUNTS)(
      "%s/receipts: reads the receipts from Expo",
      async (mount: string) => {
        const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
          `${server.origin}${mount}/receipts`,
          {
            ids: [RECEIPT_ID],
          },
        );

        expect(answer.statusCode).toBe(200);
        expect(answer.jsonData).toEqual({
          receipts: { [RECEIPT_ID]: { status: "ok" } },
        });
        expect(server.expoReceiptRequests).toEqual([[RECEIPT_ID]]);
      },
    );

    test("still refuses what it cannot read, and Expo is not asked", async () => {
      const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
        `${server.origin}/api/notification/push-relay/send`,
        { to: "not-a-push-token", title: "Incident" },
      );

      expect(answer.statusCode).toBe(400);
      expect(server.expoSends).toEqual([]);
    });
  },
);

describe("OneUptime's cloud without an Expo access token", () => {
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer({ BILLING_ENABLED: "true" });
  });

  afterAll(async () => {
    await close(server.http);
  });

  test("relays for others, and says it cannot send without the token", async () => {
    expect(server.loaded.PushNotificationService.isPushRelayServer()).toBe(
      true,
    );

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
      `${server.origin}/api/notification/push-relay/send`,
      page(),
    );

    expect(answer.statusCode).toBe(400);
    expect((answer as HTTPErrorResponse).message).toBe(
      "Push relay is not configured. EXPO_ACCESS_TOKEN is not set on this server.",
    );
  });
});

/*
 * A self-hosted server whose PUSH_NOTIFICATION_RELAY_URL names a server
 * that does not relay - another self-hosted OneUptime, say, with its own
 * Expo access token. Its pages fail, and its push log says why, in the
 * relay's own words, for its operator to read.
 */
describe("a self-hosted server sending its pages through a server that does not relay", () => {
  let notARelay: RunningServer;
  let sender: LoadedServer;
  let markAsGone: SpyInstance<typeof UserPushService.markExpoPushTokenAsGone>;
  let logs: Array<{ status: unknown; statusMessage: unknown }>;

  beforeAll(async () => {
    notARelay = await startServer(SELF_HOSTED_WITH_ITS_OWN_EXPO_TOKEN);

    sender = loadServer({
      BILLING_ENABLED: "false",
      PUSH_NOTIFICATION_RELAY_URL: `${notARelay.origin}/api/notification/push-relay/send`,
    });
  });

  afterAll(async () => {
    await close(notARelay.http);
  });

  beforeEach(() => {
    watchExpo(notARelay);
    logs = [];

    /*
     * Push is on, as on a new install: a send reads the server's switch
     * for the whole server (GlobalConfig.disablePushNotifications) first,
     * from the database this suite does not have.
     */
    jest
      .spyOn(sender.GlobalConfigService, "getPushNotificationsTurnedOff")
      .mockResolvedValue(false);

    markAsGone = jest
      .spyOn(sender.UserPushService, "markExpoPushTokenAsGone")
      .mockResolvedValue(1);

    jest
      .spyOn(sender.PushNotificationLogService, "create")
      .mockImplementation((async (createBy: {
        data: { status: unknown; statusMessage: unknown };
      }) => {
        logs.push({
          status: createBy.data.status,
          statusMessage: createBy.data.statusMessage,
        });
        return createBy.data;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("has no Expo credentials, so it relays", () => {
    expect(sender.PushNotificationService.hasExpoAccessToken()).toBe(false);
    expect(sender.PushNotificationService.isPushRelayServer()).toBe(false);
  });

  test("the page is not sent, its log says why, and the phone is not marked", async () => {
    let failure: unknown = null;

    try {
      await sender.PushNotificationService.sendPushNotification(
        {
          devices: [{ token: PHONE_TOKEN, name: "iPhone 15" }],
          message: {
            title: "Incident #7: Checkout is down",
            body: "A new incident has been created.",
          },
          deviceType: PushDeviceType.iOS,
        },
        { projectId: PROJECT_ID },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'Push relay error: {"message":"This server does not relay push notifications for other servers."}',
    );
    expect(logs).toEqual([
      { status: "Error", statusMessage: (failure as Error).message },
    ]);
    expect(markAsGone).not.toHaveBeenCalled();
    expect(notARelay.expoSends).toEqual([]);
  });

  test("its receipts are not asked of it: there are none to give", async () => {
    const answer: RelayPushReceiptsResult =
      await sender.PushNotificationService.getExpoPushReceiptsThroughRelay([
        RECEIPT_ID,
      ]);

    expect(answer).toEqual({ kind: "unavailable" });
    expect(notARelay.expoReceiptRequests).toEqual([]);
  });
});
