import PushRelayRouter, {
  parseRelayCategoryId,
} from "../../../FeatureSet/Notification/API/PushRelay";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import PushNotificationService from "Common/Server/Services/PushNotificationService";
import PushNotificationLogService from "Common/Server/Services/PushNotificationLogService";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
} from "Common/Server/Utils/Express";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import { ON_CALL_PAGE_PUSH_CATEGORY } from "Common/Types/PushNotification/PushNotificationCategory";
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
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * AN ON-CALL PAGE'S ACTIONS THROUGH THE PUSH RELAY.
 *
 * Every on-call page names the category the On-Call app draws Acknowledge
 * and Escalate under (PushNotificationCategory). A self-hosted server with no
 * Expo credentials of its own relays its pages through oneuptime.com's relay,
 * which builds the message it hands Expo field by field: a field it does not
 * read never reaches Expo. It reads the category now, and passes on only one
 * it knows - anything else is left out and the page still goes, since
 * refusing would drop a page over a button.
 *
 * Over real HTTP: the real relay router behind the real JSON parser and
 * error handler, and a copy of the product with no Expo credentials posting
 * to it with the real API client. Only Expo and the database are stood in for.
 */

const RELAY_PATH: string = "/api/notification/push-relay";
const TOKEN: string = "ExponentPushToken[relay-category-phone-1]";
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000071",
);

interface ExpoPushMessage {
  to: string | Array<string>;
  [key: string]: unknown;
}

interface ExpoClient {
  sendPushNotificationsAsync: (
    messages: Array<ExpoPushMessage>,
  ) => Promise<Array<{ status: "ok"; id: string }>>;
}

function expoClientOf(service: typeof PushNotificationService): ExpoClient {
  return (service as unknown as { expoClient: ExpoClient }).expoClient;
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

interface SelfHostedServer {
  environment: Record<string, unknown>;
  PushNotificationService: typeof PushNotificationService;
  PushNotificationLogService: typeof PushNotificationLogService;
  GlobalConfigService: typeof GlobalConfigService;
}

// Another copy of the product in this process, with no Expo credentials: it relays.
function loadSelfHostedServer(): SelfHostedServer {
  const environment: Record<string, unknown> = {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    ExpoAccessToken: undefined,
    PushNotificationRelayUrl: "",
  };

  let loaded: SelfHostedServer | null = null;

  jest.isolateModules(() => {
    jest.doMock("Common/Server/EnvironmentConfig", () => {
      return environment;
    });

    loaded = {
      environment: environment,
      PushNotificationService:
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("Common/Server/Services/PushNotificationService").default,
      PushNotificationLogService:
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("Common/Server/Services/PushNotificationLogService").default,
      GlobalConfigService:
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("Common/Server/Services/GlobalConfigService").default,
    };
  });

  jest.dontMock("Common/Server/EnvironmentConfig");

  return loaded!;
}

let relay: Server;
let relayUrl: string;
let selfHosted: SelfHostedServer;
let expoSends: Array<ExpoPushMessage>;

beforeAll(async () => {
  const relayApp: ExpressApplication = createExpressApp();
  relayApp.use(ExpressJson());
  relayApp.use(RELAY_PATH, PushRelayRouter);
  relayApp.use(expressErrorHandler);
  relay = await listen(relayApp);
  relayUrl = `http://127.0.0.1:${(relay.address() as AddressInfo).port}${RELAY_PATH}/send`;

  selfHosted = loadSelfHostedServer();
});

afterAll(async () => {
  await close(relay);
});

beforeEach(() => {
  expoSends = [];
  jest
    .spyOn(selfHosted.GlobalConfigService, "getPushNotificationsTurnedOff")
    .mockResolvedValue(false);
  jest
    .spyOn(PushNotificationService, "hasExpoAccessToken")
    .mockReturnValue(true);
  jest
    .spyOn(PushNotificationService, "isPushRelayServer")
    .mockReturnValue(true);
  jest
    .spyOn(expoClientOf(PushNotificationService), "sendPushNotificationsAsync")
    .mockImplementation((async (messages: Array<ExpoPushMessage>) => {
      expoSends.push(messages[0]!);
      return [{ status: "ok", id: "receipt-1" }];
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function relayRequest(extra: JSONObject = {}): JSONObject {
  return {
    to: TOKEN,
    title: "Incident INC-42: Checkout is down",
    body: "A new incident has been created.",
    data: {},
    sound: "default",
    priority: "high",
    channelId: "oncall_high",
    ...extra,
  };
}

async function postToRelay(
  body: JSONObject,
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
  return await API.post<JSONObject>({
    url: URL.fromString(relayUrl),
    data: body,
  });
}

describe("parseRelayCategoryId", () => {
  test("a category the server knows is passed on", () => {
    expect(parseRelayCategoryId(ON_CALL_PAGE_PUSH_CATEGORY)).toBe(
      "ON_CALL_PAGE",
    );
  });

  test("anything else is left out - never refused, so the page still goes", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "INCIDENT_ACTIONS",
      "on_call_page",
      7,
      true,
      ["ON_CALL_PAGE"],
      { id: "ON_CALL_PAGE" },
    ]) {
      expect(parseRelayCategoryId(raw)).toBeUndefined();
    }
  });
});

describe("the relay (POST /api/notification/push-relay/send)", () => {
  test("an on-call page's category reaches Expo", async () => {
    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await postToRelay(
        relayRequest({ categoryId: ON_CALL_PAGE_PUSH_CATEGORY }),
      );

    expect(answer.statusCode).toBe(200);
    expect(expoSends).toHaveLength(1);
    expect(expoSends[0]!["categoryId"]).toBe(ON_CALL_PAGE_PUSH_CATEGORY);
  });

  test.each([
    ["one it does not know", { categoryId: "SOMETHING_ELSE" }],
    ["one that is not text", { categoryId: { name: "ON_CALL_PAGE" } }],
    ["none at all - a server older than categories", {}],
  ])(
    "%s: the page goes out without one",
    async (_name: string, extra: JSONObject) => {
      const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await postToRelay(relayRequest(extra));

      expect(answer.statusCode).toBe(200);
      expect(expoSends).toHaveLength(1);
      expect(expoSends[0]).not.toHaveProperty("categoryId");
      expect(expoSends[0]!.to).toBe(TOKEN);
    },
  );
});

describe("a self-hosted server relaying an on-call page", () => {
  beforeEach(() => {
    selfHosted.environment["PushNotificationRelayUrl"] = relayUrl;
    jest
      .spyOn(selfHosted.PushNotificationLogService, "create")
      .mockImplementation((async (createBy: { data: unknown }) => {
        return createBy.data;
      }) as never);
  });

  test.each([[PushDeviceType.iOS], [PushDeviceType.Android]])(
    "%s: Acknowledge and Escalate arrive under the page, through the relay",
    async (deviceType: PushDeviceType) => {
      expect(selfHosted.PushNotificationService.hasExpoAccessToken()).toBe(
        false,
      );

      await selfHosted.PushNotificationService.sendPushNotification(
        {
          devices: [{ token: TOKEN, name: "Galaxy Z Fold" }],
          message: {
            title: "Incident INC-42: Checkout is down",
            body: "A new incident has been created.",
            categoryId: ON_CALL_PAGE_PUSH_CATEGORY,
          },
          deviceType: deviceType,
        },
        { projectId: PROJECT_ID },
      );

      expect(expoSends).toHaveLength(1);
      expect(expoSends[0]!["categoryId"]).toBe(ON_CALL_PAGE_PUSH_CATEGORY);
    },
  );

  test("a push that is not a page keeps no category on the way", async () => {
    await selfHosted.PushNotificationService.sendPushNotification(
      {
        devices: [{ token: TOKEN, name: "Galaxy Z Fold" }],
        message: {
          title: "Note posted on INC-42",
          body: "Sam: rolled back the deploy.",
        },
        deviceType: PushDeviceType.Android,
      },
      { projectId: PROJECT_ID },
    );

    expect(expoSends).toHaveLength(1);
    expect(expoSends[0]).not.toHaveProperty("categoryId");
  });
});
