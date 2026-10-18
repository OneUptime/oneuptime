import PushRelayRouter from "../../../FeatureSet/Notification/API/PushRelay";
import PushNotificationService from "Common/Server/Services/PushNotificationService";
import logger from "Common/Server/Utils/Logger";
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
 * The relay's rate limit: 60 requests a minute per client, and per route.
 * A client is an IPv4 address, or an IPv6 /64 - one host, whichever of its
 * addresses a request comes from (ClientIp getRateLimitClient).
 *
 * Over real HTTP, behind the real JSON parser and error handler. Requests
 * arrive as they do through our Nginx: X-Forwarded-For ends with the address
 * the proxy saw (TRUSTED_PROXY_HOPS 1, the shipped default).
 */

const RELAY_PATH: string = "/api/notification/push-relay";
const PHONE_TOKEN: string = "ExponentPushToken[relay-rate-limit-phone1]";
const RECEIPT_ID: string = "8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const LIMIT: number = 60;

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

function expoClientOf(service: typeof PushNotificationService): ExpoClient {
  return (service as unknown as { expoClient: ExpoClient }).expoClient;
}

let relay: Server;
let origin: string;

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson());
  app.use(RELAY_PATH, PushRelayRouter);
  app.use(expressErrorHandler);

  relay = createServer(app);

  await new Promise<void>((resolve: () => void) => {
    relay.listen(0, "127.0.0.1", resolve);
  });

  origin = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    relay.close(() => {
      resolve();
    });
  });
});

let expoSends: number;
let expoReceiptRequests: number;

/*
 * Each test counts in a minute of its own: the relay's limiters live as long
 * as the process, as they do in a server.
 */
let minute: number = Date.UTC(2031, 0, 1, 0, 0, 0);

beforeEach(() => {
  expoSends = 0;
  expoReceiptRequests = 0;
  minute += 10 * 60 * 1000;
  jest.spyOn(Date, "now").mockReturnValue(minute);

  // OneUptime's cloud: a relay, with Expo credentials.
  jest
    .spyOn(PushNotificationService, "isPushRelayServer")
    .mockReturnValue(true);
  jest
    .spyOn(PushNotificationService, "hasExpoAccessToken")
    .mockReturnValue(true);

  jest
    .spyOn(expoClientOf(PushNotificationService), "sendPushNotificationsAsync")
    .mockImplementation((async () => {
      expoSends++;
      return [{ status: "ok", id: RECEIPT_ID }];
    }) as never);

  jest
    .spyOn(
      expoClientOf(PushNotificationService),
      "getPushNotificationReceiptsAsync",
    )
    .mockImplementation((async () => {
      expoReceiptRequests++;
      return { [RECEIPT_ID]: { status: "ok" } };
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(logger.warn).mockClear();
});

// A request from `address`, as our Nginx passes it on.
async function postFrom(
  address: string,
  route: "send" | "receipts",
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
  return await API.post<JSONObject>({
    url: URL.fromString(`${origin}${RELAY_PATH}/${route}`),
    data:
      route === "send"
        ? {
            to: PHONE_TOKEN,
            title: "Incident #9: Checkout is down",
            body: "A new incident has been created.",
            data: {},
            sound: "default",
            priority: "high",
            channelId: "oncall_high",
          }
        : { ids: [RECEIPT_ID] },
    headers: { "X-Forwarded-For": address },
  });
}

function rateLimitWarnings(): Array<string> {
  return jest
    .mocked(logger.warn)
    .mock.calls.map((call: Array<unknown>): string => {
      return String(call[0]);
    })
    .filter((line: string): boolean => {
      return line.startsWith("Push relay: more than");
    });
}

describe("an IPv6 client is its /64", () => {
  test("60 pages a minute from one /64, from whichever of its addresses: the 61st is refused, and Expo is not asked", async () => {
    for (let host: number = 1; host <= LIMIT; host++) {
      const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await postFrom(`2001:db8:a:1::${host.toString(16)}`, "send");

      expect(answer.statusCode).toBe(200);
    }

    const refused: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await postFrom("2001:db8:a:1:ffff:ffff:ffff:fffe", "send");

    expect(refused.statusCode).toBe(429);
    expect(refused.jsonData).toEqual({
      message: "Rate limit exceeded. Please try again later.",
    });
    expect(expoSends).toBe(LIMIT);
  });

  test("another /64 has a minute of its own", async () => {
    for (let host: number = 1; host <= LIMIT + 5; host++) {
      await postFrom(`2001:db8:b:1::${host.toString(16)}`, "send");
    }

    const neighbour: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await postFrom("2001:db8:b:2::1", "send");

    expect(neighbour.statusCode).toBe(200);
    expect(expoSends).toBe(LIMIT + 1);
  });

  test("every spelling of one address is the same client", async () => {
    const spellings: Array<string> = [
      "2001:db8:c:1::1",
      "2001:DB8:C:1::1",
      "2001:0db8:000c:0001:0000:0000:0000:0001",
      "[2001:db8:c:1::1]:443",
    ];

    for (let request: number = 0; request < LIMIT; request++) {
      const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await postFrom(spellings[request % spellings.length]!, "send");

      expect(answer.statusCode).toBe(200);
    }

    for (const spelling of spellings) {
      expect((await postFrom(spelling, "send")).statusCode).toBe(429);
    }
  });

  test("a new minute starts a new count", async () => {
    for (let host: number = 1; host <= LIMIT + 1; host++) {
      await postFrom(`2001:db8:d:1::${host.toString(16)}`, "send");
    }

    expect((await postFrom("2001:db8:d:1::abc", "send")).statusCode).toBe(429);

    jest.spyOn(Date, "now").mockReturnValue(minute + 61 * 1000);

    expect((await postFrom("2001:db8:d:1::abc", "send")).statusCode).toBe(200);
  });

  test("receipts are counted the same way, and never use up the pages' minute", async () => {
    for (let host: number = 1; host <= LIMIT; host++) {
      const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await postFrom(`2001:db8:e:1::${host.toString(16)}`, "receipts");

      expect(answer.statusCode).toBe(200);
    }

    expect((await postFrom("2001:db8:e:1::beef", "receipts")).statusCode).toBe(
      429,
    );
    expect(expoReceiptRequests).toBe(LIMIT);

    // The same /64's page still goes out.
    expect((await postFrom("2001:db8:e:1::cafe", "send")).statusCode).toBe(200);
  });

  test("only the first refusal of a client's minute is logged, naming the /64", async () => {
    for (let host: number = 1; host <= LIMIT + 10; host++) {
      await postFrom(`2001:db8:f:1::${host.toString(16)}`, "send");
    }

    expect(rateLimitWarnings()).toEqual([
      "Push relay: more than 60 send requests in a minute from 2001:db8:f:1::/64. Refusing them until the minute is over.",
    ]);
  });
});

describe("an IPv4 client is its address", () => {
  test("60 pages a minute from one address, then 429; another address has its own minute", async () => {
    for (let request: number = 1; request <= LIMIT; request++) {
      expect((await postFrom("198.51.100.20", "send")).statusCode).toBe(200);
    }

    expect((await postFrom("198.51.100.20", "send")).statusCode).toBe(429);
    expect((await postFrom("198.51.100.21", "send")).statusCode).toBe(200);
    expect(expoSends).toBe(LIMIT + 1);
  });

  test("an IPv4 address reached as IPv4-mapped IPv6 is that IPv4 address", async () => {
    for (let request: number = 1; request <= LIMIT; request++) {
      await postFrom("198.51.100.30", "send");
    }

    expect((await postFrom("::ffff:198.51.100.30", "send")).statusCode).toBe(
      429,
    );
  });

  test("the receipts route logs its own first refusal", async () => {
    for (let request: number = 1; request <= LIMIT + 3; request++) {
      await postFrom("198.51.100.40", "receipts");
    }

    expect(rateLimitWarnings()).toEqual([
      "Push relay: more than 60 receipts requests in a minute from 198.51.100.40. Refusing them until the minute is over.",
    ]);
  });
});
