/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A STATUS PAGE SUBSCRIBER'S OWN WEBHOOK, FOR THE PLATFORM'S OPERATOR
 * (issue #6685).
 *
 * Every post to a subscriber's webhook - whichever job or service sends it
 * - is counted once (notification.send.count) and timed
 * (notification.send.duration): channel and provider "webhook", on the
 * project's side ("project": the endpoint is the subscriber's, not the
 * installation's), never an on-call page, and told apart from a person's
 * webhook by notification.destination "status_page_subscriber".
 *
 *   - success: the endpoint answered with a 2xx status;
 *   - failure: it answered with anything else, the post threw once
 *     API.post's own retries were spent, or the address was refused before
 *     any request - the subscriber got nothing either way.
 *
 * Counted once however many times API.post tried, and what the sender
 * answers or throws is passed on unchanged. No attribute names the
 * subscriber, its URL, its host or what it was sent. A recording that
 * fails never fails the send.
 *
 * The address check is the real one (a stand-in DNS answers it), and the
 * posts are either stood in for or - where how often the post was tried
 * matters - made for real, to a server on this machine.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const sendCounterCalls: Array<RecordedCall> = [];
const sendDurationCalls: Array<RecordedCall> = [];

// While true, the instruments throw, as an exporter that is down might.
let failInstruments: boolean = false;

jest.mock("../../../Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            if (failInstruments) {
              throw new Error("The metrics exporter is down.");
            }

            sendCounterCalls.push({ value, attributes });
          },
        };
      },
      getNotificationDuration: () => {
        return {
          record: (value: number, attributes: Record<string, string>): void => {
            if (failInstruments) {
              throw new Error("The metrics exporter is down.");
            }

            sendDurationCalls.push({ value, attributes });
          },
        };
      },
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

import StatusPageSubscriberWebhookUtil, {
  SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT,
  StatusPageWebhookPayload,
} from "../../../Server/Utils/StatusPageSubscriberWebhook";
import {
  NotificationDeliveryChannel,
  NotificationDeliveryOutcome,
  NotificationDeliveryProvider,
  NotificationDestination,
  NotificationMetricAttribute,
  NotificationProviderConfig,
} from "../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import APIException from "../../../Types/Exception/ApiException";
import { JSONObject } from "../../../Types/JSON";
import Sleep from "../../../Types/Sleep";
import API, { APIRequestOptions, RequestOptions } from "../../../Utils/API";
import axios from "axios";
import dns from "dns";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";

const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";
const BLOCK_ENV: string = "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES";
const BILLING_ENV: string = "BILLING_ENABLED";
const PROXY_ENVS: Array<string> = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
];

// A webhook URL a subscriber might give: a secret token in its path and query.
const SECRET_TOKEN: string = "s3cr3t-subscriber-token-6685";
const PUBLIC_HOOK: string = `https://hooks.acme-subscriber.example/v1/${SECRET_TOKEN}?key=${SECRET_TOKEN}`;
const PUBLIC_HOST: string = "hooks.acme-subscriber.example";

const STATUS_PAGE_ID: string = "6685a1b2-0000-4000-8000-000000000001";
const STATUS_PAGE_NAME: string = "Acme Payments Status";

const PAYLOAD: StatusPageWebhookPayload = {
  eventType: "IncidentCreated",
  statusPageId: STATUS_PAGE_ID,
  statusPageName: STATUS_PAGE_NAME,
  statusPageUrl: "https://status.acme.example",
  unsubscribeUrl: `https://status.acme.example/unsubscribe/${SECRET_TOKEN}`,
  data: {
    incidentTitle: "Card payments are failing for Ana Lopez",
    incidentNumber: "42",
  },
};

// What every post to a subscriber's webhook is counted as, but its outcome.
const SUBSCRIBER_WEBHOOK: Record<string, string> = {
  "notification.channel": "webhook",
  "notification.provider": "webhook",
  "notification.provider.config": "project",
  "notification.on_call_page": "false",
  "notification.destination": "status_page_subscriber",
};

// What DNS answers, by host. A host not named here does not resolve.
const DNS_ANSWERS: Record<string, string> = {
  [PUBLIC_HOST]: "93.184.216.34",
  "hooks.example.com": "93.184.216.35",
  "internal.acme.example": "10.20.30.40",
};

const IPV4_LITERAL: RegExp = /^\d{1,3}(\.\d{1,3}){3}$/;

const savedEnv: Record<string, string | undefined> = {};
let post: SpyInstance<typeof API.post> | null = null;
let lookup: SpyInstance<typeof dns.promises.lookup> | null = null;

function restoreEnv(): void {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

beforeEach(() => {
  sendCounterCalls.length = 0;
  sendDurationCalls.length = 0;
  failInstruments = false;

  for (const name of [
    ALLOW_ENV,
    ALLOWLIST_ENV,
    BLOCK_ENV,
    BILLING_ENV,
    ...PROXY_ENVS,
  ]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }

  lookup = jest.spyOn(dns.promises, "lookup").mockImplementation((async (
    hostname: string,
  ) => {
    const address: string | undefined = IPV4_LITERAL.test(hostname)
      ? hostname
      : DNS_ANSWERS[hostname];

    if (!address) {
      const error: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${hostname}`,
      );
      error.code = "ENOTFOUND";
      throw error;
    }

    return [{ address: address, family: 4 }];
  }) as never) as unknown as SpyInstance<typeof dns.promises.lookup>;
});

afterEach(() => {
  jest.restoreAllMocks();
  post = null;
  lookup = null;
  restoreEnv();
});

// API.post stood in for: each call answers the next of `answers` in turn.
function standInPosts(
  answers: Array<HTTPResponse<JSONObject> | HTTPErrorResponse | Error>,
): SpyInstance<typeof API.post> {
  post = jest.spyOn(API, "post").mockImplementation((async (): Promise<
    HTTPResponse<JSONObject> | HTTPErrorResponse
  > => {
    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse | Error =
      answers.shift() || new HTTPResponse<JSONObject>(200, {}, {});

    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  }) as typeof API.post) as unknown as SpyInstance<typeof API.post>;

  return post;
}

async function send(data?: {
  webhookUrl?: string | undefined;
  isAddedByTeam?: boolean | undefined;
}): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
  return await StatusPageSubscriberWebhookUtil.sendWebhookNotification({
    webhookUrl: URL.fromString(data?.webhookUrl || PUBLIC_HOOK),
    isAddedByTeam: data?.isAddedByTeam ?? false,
    payload: PAYLOAD,
  });
}

function outcomes(): Array<string | undefined> {
  return sendCounterCalls.map((call: RecordedCall): string | undefined => {
    return call.attributes["outcome"];
  });
}

describe("a post to a status page subscriber's webhook is counted once, for the platform's operator", () => {
  test("a delivered post: one count of 1 and one time, both with the subscriber webhook's attributes and success", async () => {
    standInPosts([new HTTPResponse<JSONObject>(200, { ok: true }, {})]);

    await send();

    const attributes: Record<string, string> = {
      ...SUBSCRIBER_WEBHOOK,
      outcome: "success",
    };

    expect(sendCounterCalls).toEqual([{ value: 1, attributes: attributes }]);
    expect(sendDurationCalls).toHaveLength(1);
    expect(sendDurationCalls[0]!.attributes).toEqual(attributes);
    expect(typeof sendDurationCalls[0]!.value).toBe("number");
    expect(sendDurationCalls[0]!.value).toBeGreaterThanOrEqual(0);
  });

  test("its attributes are spelled as the metrics' own enums spell them", async () => {
    standInPosts([new HTTPResponse<JSONObject>(204, {}, {})]);

    await send();

    expect(sendCounterCalls[0]!.attributes).toEqual({
      [NotificationMetricAttribute.Channel]:
        NotificationDeliveryChannel.Webhook,
      [NotificationMetricAttribute.Provider]:
        NotificationDeliveryProvider.Webhook,
      [NotificationMetricAttribute.ProviderConfig]:
        NotificationProviderConfig.Project,
      [NotificationMetricAttribute.OnCallPage]: "false",
      [NotificationMetricAttribute.Destination]:
        NotificationDestination.StatusPageSubscriber,
      [NotificationMetricAttribute.Outcome]:
        NotificationDeliveryOutcome.Success,
    });
  });

  test("the time is how long the post took, the address check included", async () => {
    const checkTakesInMs: number = 60;
    const postTakesInMs: number = 90;

    lookup!.mockImplementation((async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, checkTakesInMs);
      });

      return [{ address: "93.184.216.34", family: 4 }];
    }) as never);
    post = jest.spyOn(API, "post").mockImplementation((async (): Promise<
      HTTPResponse<JSONObject>
    > => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, postTakesInMs);
      });

      return new HTTPResponse<JSONObject>(200, {}, {});
    }) as typeof API.post) as unknown as SpyInstance<typeof API.post>;

    await send();

    // Timers can fire a millisecond early; well within a few.
    expect(sendDurationCalls[0]!.value).toBeGreaterThanOrEqual(
      checkTakesInMs + postTakesInMs - 5,
    );
    expect(sendDurationCalls[0]!.value).toBeLessThan(5000);
  });

  test.each([
    ["200 OK", "success", new HTTPResponse<JSONObject>(200, {}, {})],
    ["201 Created", "success", new HTTPResponse<JSONObject>(201, {}, {})],
    ["202 Accepted", "success", new HTTPResponse<JSONObject>(202, {}, {})],
    ["204 No Content", "success", new HTTPResponse<JSONObject>(204, {}, {})],
    ["299, the last 2xx", "success", new HTTPResponse<JSONObject>(299, {}, {})],
    [
      "a 3xx answered as a response",
      "failure",
      new HTTPResponse<JSONObject>(300, {}, {}),
    ],
    [
      "a 404 answered as a response",
      "failure",
      new HTTPResponse<JSONObject>(404, {}, {}),
    ],
    [
      "a 1xx answered as a response",
      "failure",
      new HTTPResponse<JSONObject>(199, {}, {}),
    ],
    [
      "a redirect, not followed",
      "failure",
      new HTTPErrorResponse(302, { message: "Found" }, {}),
    ],
    [
      "400 Bad Request",
      "failure",
      new HTTPErrorResponse(400, { message: "Bad Request" }, {}),
    ],
    [
      "401 Unauthorized",
      "failure",
      new HTTPErrorResponse(401, { message: "Unauthorized" }, {}),
    ],
    [
      "404 Not Found, a deleted webhook",
      "failure",
      new HTTPErrorResponse(404, { message: "Not Found" }, {}),
    ],
    [
      "410 Gone",
      "failure",
      new HTTPErrorResponse(410, { message: "Gone" }, {}),
    ],
    [
      "429 Too Many Requests",
      "failure",
      new HTTPErrorResponse(429, { message: "Slow down" }, {}),
    ],
    [
      "500 Internal Server Error",
      "failure",
      new HTTPErrorResponse(500, { message: "Boom" }, {}),
    ],
    [
      "503 Service Unavailable",
      "failure",
      new HTTPErrorResponse(503, { message: "Unavailable" }, {}),
    ],
    [
      "an error answer whatever its status",
      "failure",
      new HTTPErrorResponse(200, { message: "Odd" }, {}),
    ],
  ])(
    "an answer of %s is a %s, counted once and timed, and answered back as it came",
    async (
      _name: string,
      outcome: string,
      answer: HTTPResponse<JSONObject> | HTTPErrorResponse,
    ) => {
      standInPosts([answer]);

      const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send();

      expect(result).toBe(answer);
      expect(sendCounterCalls).toEqual([
        { value: 1, attributes: { ...SUBSCRIBER_WEBHOOK, outcome: outcome } },
      ]);
      expect(sendDurationCalls).toHaveLength(1);
      expect(sendDurationCalls[0]!.attributes).toEqual(
        sendCounterCalls[0]!.attributes,
      );
    },
  );

  test("a post that threw - no answer, once API.post's own retries were spent - is a failure, timed, and the error is passed on as it was", async () => {
    const thrown: APIException = new APIException(
      "connect ECONNREFUSED 93.184.216.34:443",
    );

    standInPosts([thrown]);

    await expect(send()).rejects.toBe(thrown);

    expect(sendCounterCalls).toEqual([
      { value: 1, attributes: { ...SUBSCRIBER_WEBHOOK, outcome: "failure" } },
    ]);
    expect(sendDurationCalls).toHaveLength(1);
  });

  test("whatever is thrown, even something that is no Error, is a failure and passed on", async () => {
    post = jest.spyOn(API, "post").mockImplementation((async (): Promise<
      HTTPResponse<JSONObject>
    > => {
      throw "socket hang up";
    }) as typeof API.post) as unknown as SpyInstance<typeof API.post>;

    await expect(send()).rejects.toBe("socket hang up");
    expect(outcomes()).toEqual(["failure"]);
  });

  test("the post is made once a message, asked to try again on its own, and counted once", async () => {
    const posts: SpyInstance<typeof API.post> = standInPosts([
      new HTTPResponse<JSONObject>(200, {}, {}),
    ]);

    await send();

    expect(posts).toHaveBeenCalledTimes(1);

    const options: RequestOptions | undefined = (
      posts.mock.calls[0]![0] as APIRequestOptions
    ).options;

    // As it always was: tried again, backing off, and never redirected.
    expect(options).toEqual({
      retries: 3,
      exponentialBackoff: true,
      doNotFollowRedirects: true,
    });
    expect(sendCounterCalls).toHaveLength(1);
  });

  test("each message is its own count: three subscribers, three counts, each with its own outcome", async () => {
    standInPosts([
      new HTTPResponse<JSONObject>(200, {}, {}),
      new HTTPErrorResponse(500, { message: "Boom" }, {}),
      new HTTPResponse<JSONObject>(202, {}, {}),
    ]);

    await send();
    await send({ webhookUrl: "https://hooks.example.com/second" });
    await send({ webhookUrl: "https://hooks.example.com/third" });

    expect(outcomes()).toEqual(["success", "failure", "success"]);
    expect(sendDurationCalls).toHaveLength(3);
  });

  test("sends at the same time are counted apart, each with its own outcome", async () => {
    post = jest.spyOn(API, "post").mockImplementation((async (data: {
      url: URL;
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const isDown: boolean = data.url.toString().includes("down");

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, isDown ? 5 : 20);
      });

      return isDown
        ? new HTTPErrorResponse(503, { message: "Unavailable" }, {})
        : new HTTPResponse<JSONObject>(200, {}, {});
    }) as unknown as typeof API.post) as unknown as SpyInstance<
      typeof API.post
    >;

    await Promise.all([
      send({ webhookUrl: "https://hooks.example.com/up-1" }),
      send({ webhookUrl: "https://hooks.example.com/down-1" }),
      send({ webhookUrl: "https://hooks.example.com/up-2" }),
      send({ webhookUrl: "https://hooks.example.com/down-2" }),
    ]);

    expect(outcomes().sort()).toEqual([
      "failure",
      "failure",
      "success",
      "success",
    ]);
    expect(sendDurationCalls).toHaveLength(4);
  });
});

describe("an address that is not allowed: a failure, with no request made", () => {
  test.each([
    ["a private address", "http://10.0.0.5/hook"],
    ["loopback", "http://127.0.0.1:9200/hook"],
    ["the cloud metadata endpoint", "http://169.254.169.254/latest/meta-data/"],
    ["a name that resolves privately", "https://internal.acme.example/hook"],
    ["a name that does not resolve", "https://nowhere.acme.example/hook"],
  ])(
    "%s, for a subscriber that signed up, is refused, answered as before, and counted once as a failure",
    async (_name: string, webhookUrl: string) => {
      const posts: SpyInstance<typeof API.post> = standInPosts([]);

      const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send({
        webhookUrl: webhookUrl,
        isAddedByTeam: false,
      });

      expect(posts).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(HTTPErrorResponse);
      expect((result as HTTPErrorResponse).statusCode).toBe(400);
      expect(sendCounterCalls).toEqual([
        {
          value: 1,
          attributes: { ...SUBSCRIBER_WEBHOOK, outcome: "failure" },
        },
      ]);
      // Timed too: the check is part of the send, as for a person's webhook.
      expect(sendDurationCalls).toHaveLength(1);
    },
  );

  test("the refusal the team reads still says why, word for word", async () => {
    standInPosts([]);

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send({
      webhookUrl: "http://10.0.0.5/hook",
      isAddedByTeam: false,
    });

    expect(String((result as HTTPErrorResponse).message)).toContain(
      SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT.trim(),
    );
    expect(outcomes()).toEqual(["failure"]);
  });

  test("a private address the team added, on an instance that allows none, is refused and a failure", async () => {
    const posts: SpyInstance<typeof API.post> = standInPosts([]);

    await send({ webhookUrl: "http://10.0.0.5/hook", isAddedByTeam: true });

    expect(posts).not.toHaveBeenCalled();
    expect(outcomes()).toEqual(["failure"]);
  });

  test("a private address the team added, on an instance that allows private networks, is posted to and counted as any other", async () => {
    process.env[ALLOW_ENV] = "true";

    const posts: SpyInstance<typeof API.post> = standInPosts([
      new HTTPResponse<JSONObject>(200, {}, {}),
    ]);

    await send({ webhookUrl: "http://10.0.0.5/hook", isAddedByTeam: true });

    expect(posts).toHaveBeenCalledTimes(1);
    expect(sendCounterCalls).toEqual([
      { value: 1, attributes: { ...SUBSCRIBER_WEBHOOK, outcome: "success" } },
    ]);
  });

  test("the same private address from a sign-up stays refused on that instance, and a failure", async () => {
    process.env[ALLOW_ENV] = "true";

    const posts: SpyInstance<typeof API.post> = standInPosts([]);

    await send({ webhookUrl: "http://10.0.0.5/hook", isAddedByTeam: false });

    expect(posts).not.toHaveBeenCalled();
    expect(outcomes()).toEqual(["failure"]);
  });
});

describe("what the count never says", () => {
  // Every value the attributes may take: the enums' own, and a page's two.
  const FIXED_VALUES: Set<string> = new Set<string>([
    ...Object.values(NotificationDeliveryChannel),
    ...Object.values(NotificationDeliveryProvider),
    ...Object.values(NotificationProviderConfig),
    ...Object.values(NotificationDestination),
    ...Object.values(NotificationDeliveryOutcome),
    "true",
    "false",
  ]);

  test("no URL, host, token, status page or payload in any attribute, whatever the outcome", async () => {
    standInPosts([
      new HTTPResponse<JSONObject>(200, {}, {}),
      new HTTPErrorResponse(500, { message: `Boom at ${PUBLIC_HOOK}` }, {}),
      new APIException(`getaddrinfo ENOTFOUND ${PUBLIC_HOST}`),
    ]);

    await send();
    await send();
    await send().catch(() => {
      return null;
    });
    await send({ webhookUrl: `http://10.0.0.5/${SECRET_TOKEN}` });

    const recorded: Array<RecordedCall> = [
      ...sendCounterCalls,
      ...sendDurationCalls,
    ];

    expect(sendCounterCalls).toHaveLength(4);

    for (const call of recorded) {
      for (const [name, value] of Object.entries(call.attributes)) {
        expect({ name, fixed: FIXED_VALUES.has(value) }).toEqual({
          name,
          fixed: true,
        });

        for (const secret of [
          SECRET_TOKEN,
          PUBLIC_HOST,
          "10.0.0.5",
          STATUS_PAGE_ID,
          STATUS_PAGE_NAME,
          PAYLOAD.eventType,
          "Ana Lopez",
        ]) {
          expect(value).not.toContain(secret);
        }
      }

      expect(Object.keys(call.attributes).sort()).toEqual(
        [...Object.keys(SUBSCRIBER_WEBHOOK), "outcome"].sort(),
      );
    }
  });
});

describe("a recording that fails never fails the send", () => {
  test("with the instruments throwing, a delivered post is answered as it came", async () => {
    failInstruments = true;

    const answer: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
      200,
      { ok: true },
      {},
    );

    standInPosts([answer]);

    await expect(send()).resolves.toBe(answer);
    expect(sendCounterCalls).toHaveLength(0);
  });

  test("with the instruments throwing, a failed post is answered as it came, and a throw is passed on as it was", async () => {
    failInstruments = true;

    const refused: HTTPErrorResponse = new HTTPErrorResponse(
      503,
      { message: "Unavailable" },
      {},
    );
    const thrown: APIException = new APIException("socket hang up");

    standInPosts([refused, thrown]);

    await expect(send()).resolves.toBe(refused);
    await expect(send()).rejects.toBe(thrown);
  });
});

describe("whether an endpoint took a post (isDelivered)", () => {
  test.each([
    ["no answer at all", false, null],
    ["undefined", false, undefined],
    ["200", true, new HTTPResponse<JSONObject>(200, {}, {})],
    ["204", true, new HTTPResponse<JSONObject>(204, {}, {})],
    ["299", true, new HTTPResponse<JSONObject>(299, {}, {})],
    ["199", false, new HTTPResponse<JSONObject>(199, {}, {})],
    ["300", false, new HTTPResponse<JSONObject>(300, {}, {})],
    ["404 as a response", false, new HTTPResponse<JSONObject>(404, {}, {})],
    [
      "an error answer of 200",
      false,
      new HTTPErrorResponse(200, { message: "Odd" }, {}),
    ],
    [
      "an error answer of 302",
      false,
      new HTTPErrorResponse(302, { message: "Found" }, {}),
    ],
    [
      "an error answer of 500",
      false,
      new HTTPErrorResponse(500, { message: "Boom" }, {}),
    ],
  ])(
    "%s: delivered %s",
    (
      _name: string,
      delivered: boolean,
      response: HTTPResponse<JSONObject> | HTTPErrorResponse | null | undefined,
    ) => {
      expect(StatusPageSubscriberWebhookUtil.isDelivered(response)).toBe(
        delivered,
      );
    },
  );
});

/*
 * Real posts, to a server on this machine: how often API.post tries is its
 * own, and a message is counted once however many tries it took. The
 * subscriber is one the team added, on an instance whose allowlist names
 * loopback exactly - the one way a webhook may reach this machine. The
 * backoff between tries is skipped, not the tries.
 */
describe("counted once however many times the post was tried, against a real endpoint", () => {
  let server: http.Server;
  let port: number = 0;
  // How the endpoint answers each request, in turn; 200 once they run out.
  let statuses: Array<number> = [];
  let requests: Array<string> = [];
  const originalAdapter: typeof axios.defaults.adapter = axios.defaults.adapter;

  beforeAll(async () => {
    /*
     * Common's jest environment is jsdom, where axios is its browser build
     * and picks XHR. The servers OneUptime sends from run Node: this file
     * resolves packages as Node does (the docblock at its top), and posts
     * through axios's Node adapter.
     */
    axios.defaults.adapter = "http";

    server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        requests.push(request.url || "");

        let body: string = "";

        request.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });

        request.on("end", () => {
          const status: number = statuses.shift() || 200;

          if (status >= 300 && status < 400) {
            response.writeHead(status, {
              Location: `http://127.0.0.1:${port}/redirected`,
            });
            response.end();
            return;
          }

          response.writeHead(status, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({ received: body.length > 0, status: status }),
          );
        });
      },
    );

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (originalAdapter === undefined) {
      delete axios.defaults.adapter;
    } else {
      axios.defaults.adapter = originalAdapter;
    }

    server.closeAllConnections();

    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    statuses = [];
    requests = [];
    process.env[ALLOW_ENV] = "true";
    process.env[ALLOWLIST_ENV] = "127.0.0.1";

    // The backoff between tries, skipped: the tries themselves are real.
    jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);
  });

  function hook(): string {
    return `http://127.0.0.1:${port}/hook`;
  }

  test("an endpoint that answers 503 twice and then 200 was tried three times: one success", async () => {
    statuses = [503, 503, 200];

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send({
      webhookUrl: hook(),
      isAddedByTeam: true,
    });

    expect(requests).toEqual(["/hook", "/hook", "/hook"]);
    expect(result).toBeInstanceOf(HTTPResponse);
    expect(result).not.toBeInstanceOf(HTTPErrorResponse);
    expect(result.statusCode).toBe(200);
    expect(sendCounterCalls).toEqual([
      { value: 1, attributes: { ...SUBSCRIBER_WEBHOOK, outcome: "success" } },
    ]);
    expect(sendDurationCalls).toHaveLength(1);
  });

  test("an endpoint that answers 500 every time was tried four times: one failure", async () => {
    statuses = [500, 500, 500, 500];

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send({
      webhookUrl: hook(),
      isAddedByTeam: true,
    });

    expect(requests).toHaveLength(4);
    expect(result).toBeInstanceOf(HTTPErrorResponse);
    expect(result.statusCode).toBe(500);
    expect(sendCounterCalls).toEqual([
      { value: 1, attributes: { ...SUBSCRIBER_WEBHOOK, outcome: "failure" } },
    ]);
  });

  test("an endpoint that redirects is not followed: one failure, and the redirect's target never asked", async () => {
    statuses = [302, 302, 302, 302];

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send({
      webhookUrl: hook(),
      isAddedByTeam: true,
    });

    expect(
      requests.every((url: string): boolean => {
        return url === "/hook";
      }),
    ).toBe(true);
    expect(requests).not.toContain("/redirected");
    expect(result).toBeInstanceOf(HTTPErrorResponse);
    expect(outcomes()).toEqual(["failure"]);
  });

  test("an endpoint that answers 204 at once was tried once: one success", async () => {
    statuses = [204];

    await send({ webhookUrl: hook(), isAddedByTeam: true });

    expect(requests).toEqual(["/hook"]);
    expect(outcomes()).toEqual(["success"]);
  });

  test("an endpoint nobody listens on threw on every try: one failure, and the throw passed on", async () => {
    const closed: http.Server = http.createServer();

    await new Promise<void>((resolve: () => void) => {
      closed.listen(0, "127.0.0.1", resolve);
    });

    const closedPort: number = (closed.address() as AddressInfo).port;

    await new Promise<void>((resolve: () => void) => {
      closed.close(() => {
        resolve();
      });
    });

    await expect(
      send({
        webhookUrl: `http://127.0.0.1:${closedPort}/hook`,
        isAddedByTeam: true,
      }),
    ).rejects.toBeInstanceOf(Error);

    expect(sendCounterCalls).toEqual([
      { value: 1, attributes: { ...SUBSCRIBER_WEBHOOK, outcome: "failure" } },
    ]);
  });
});

/*
 * Counted in one place: every sender posts through
 * StatusPageSubscriberWebhookUtil.sendWebhookNotification (the senders
 * guard holds each to the subscriber it sends to), which records, so none
 * may record a subscriber's webhook again.
 */
describe("one place records a subscriber's webhook", () => {
  const PACKAGES_ROOT: string = path.join(__dirname, "..", "..", "..", "..");
  const SKIPPED: Array<string> = ["node_modules", "build", "dist", "Tests"];

  function sourceFiles(folder: string): Array<string> {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED.includes(entry.name)) {
          files.push(...sourceFiles(path.join(folder, entry.name)));
        }
        continue;
      }

      if (
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(path.join(folder, entry.name));
      }
    }

    return files;
  }

  test("only the subscriber webhook sender names the status_page_subscriber destination", () => {
    const naming: Array<string> = [
      ...sourceFiles(path.join(PACKAGES_ROOT, "Common", "Server")),
      ...sourceFiles(path.join(PACKAGES_ROOT, "App", "FeatureSet")),
    ]
      .filter((file: string): boolean => {
        return fs
          .readFileSync(file, "utf8")
          .includes("NotificationDestination.StatusPageSubscriber");
      })
      .map((file: string): string => {
        return path.relative(PACKAGES_ROOT, file);
      });

    expect(naming).toEqual([
      path.join("Common", "Server", "Utils", "StatusPageSubscriberWebhook.ts"),
    ]);
  });
});
