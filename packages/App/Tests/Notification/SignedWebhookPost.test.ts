import SignedWebhookPost, {
  MAX_SIGNED_WEBHOOK_BODY_LENGTH,
  SIGNED_WEBHOOK_MAX_ATTEMPTS,
  SIGNED_WEBHOOK_REQUEST_TIMEOUT_MS,
  SIGNED_WEBHOOK_RETRY_DELAYS_MS,
  SignedPostOutcome,
  isRetryableStatus,
  signWebhookBody,
} from "../../FeatureSet/Notification/Utils/SignedWebhookPost";
import { CALL_AND_SMS_GATEWAY_USER_AGENT } from "../../FeatureSet/Notification/Services/CallAndSmsGatewayService";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  CUSTOM_CHANNEL_EVENT_HEADER,
  CUSTOM_CHANNEL_SIGNATURE_HEADER,
} from "Common/Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import crypto from "crypto";

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
  };
});

/*
 * POSTING A SIGNED REQUEST, AND TRYING IT AGAIN: SignedWebhookPost.post.
 *
 * The server's SMS and call gateway (CallAndSmsGatewayService) - and the
 * Enterprise Edition's custom channels - post to a service the
 * installation runs through this one function, so one verifier serves both
 * and both are retried alike:
 *
 *   - a JSON POST, its event in X-OneUptime-Event and the HMAC-SHA256 of its
 *     exact body, keyed with the secret, in X-OneUptime-Signature;
 *   - the User-Agent its caller names;
 *   - each attempt waits SIGNED_WEBHOOK_REQUEST_TIMEOUT_MS and follows no
 *     redirect;
 *   - no answer, 408, 429 or a 5xx is tried again after 1 and then 4 more
 *     seconds, three attempts in all; any other answer is final.
 *
 * It answers how the last attempt went and how many there were, and leaves
 * the wording to its callers.
 */

const URL_TEXT: string = "https://sms-gateway.internal.example.com/oneuptime";
const SECRET: string = "e".repeat(64);
const USER_AGENT: string = "OneUptime-Test/1.0";

const PAYLOAD: JSONObject = {
  version: 1,
  event: "sms",
  id: "7c5b0d0e-3e5f-4d1a-9a4f-2b8e6c1d9f00",
  to: "+15551234567",
  message: "Incident #42: Database is down",
};

let post: jest.SpyInstance;
let sleep: jest.SpyInstance;

function ok(status: number = 200): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(status, {}, {});
}

function refused(status: number): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: "nope" }, {});
}

async function postSigned(
  overrides: Partial<{
    url: string;
    secret: string;
    eventType: string;
    payload: JSONObject;
    userAgent: string;
  }> = {},
): Promise<SignedPostOutcome> {
  return await SignedWebhookPost.post({
    url: URL_TEXT,
    secret: SECRET,
    eventType: "sms",
    payload: PAYLOAD,
    userAgent: USER_AGENT,
    ...overrides,
  });
}

function requestOf(index: number = 0): Record<string, unknown> {
  return post.mock.calls[index]![0] as Record<string, unknown>;
}

function headersOf(index: number = 0): Record<string, string> {
  return requestOf(index)["headers"] as Record<string, string>;
}

function hmac(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

// The verifier the docs give a gateway (self-hosted/sms-and-call-gateway).
function isFromOneUptime(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected: string =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received: string = String(signatureHeader || "");

  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  );
}

function sleeps(): Array<unknown> {
  return sleep.mock.calls.map((call: Array<unknown>) => {
    return call[0];
  });
}

beforeEach(() => {
  post = jest.spyOn(API, "post").mockResolvedValue(ok());
  sleep = jest.spyOn(SignedWebhookPost, "sleep").mockResolvedValue();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the limits", () => {
  test("one attempt waits 10 seconds; three attempts in all, 1 then 4 seconds apart", () => {
    expect(SIGNED_WEBHOOK_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(SIGNED_WEBHOOK_MAX_ATTEMPTS).toBe(3);
    expect([...SIGNED_WEBHOOK_RETRY_DELAYS_MS]).toEqual([1000, 4000]);
    // A wait before every attempt but the first.
    expect(SIGNED_WEBHOOK_RETRY_DELAYS_MS).toHaveLength(
      SIGNED_WEBHOOK_MAX_ATTEMPTS - 1,
    );
  });

  test("a body of at most 200,000 characters, a backstop well above any message's budget", () => {
    expect(MAX_SIGNED_WEBHOOK_BODY_LENGTH).toBe(200_000);
  });

  test.each([
    [400, false],
    [401, false],
    [404, false],
    [407, false],
    [408, true],
    [409, false],
    [422, false],
    [429, true],
    [499, false],
    [500, true],
    [503, true],
    [599, true],
  ])(
    "HTTP %i is worth trying again: %p",
    (status: number, expected: boolean) => {
      expect(isRetryableStatus(status)).toBe(expected);
    },
  );
});

describe("what is sent", () => {
  test("a POST to the URL, carrying the payload, with a timeout and no redirects", async () => {
    await postSigned();

    expect(post).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = requestOf();

    expect(request["url"]).toBeInstanceOf(URL);
    expect(request["url"]!.toString()).toBe(URL_TEXT);
    expect(request["data"]).toEqual(PAYLOAD);
    expect(request["options"]).toEqual({
      timeout: SIGNED_WEBHOOK_REQUEST_TIMEOUT_MS,
      doNotFollowRedirects: true,
    });
  });

  test("exactly four headers: JSON, the caller's User-Agent, the event and the signature", async () => {
    await postSigned({ eventType: "call" });

    expect(headersOf()).toEqual({
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "X-OneUptime-Event": "call",
      "X-OneUptime-Signature": hmac(SECRET, JSON.stringify(PAYLOAD)),
    });
    expect(CUSTOM_CHANNEL_EVENT_HEADER).toBe("X-OneUptime-Event");
    expect(CUSTOM_CHANNEL_SIGNATURE_HEADER).toBe("X-OneUptime-Signature");
  });

  test("the signature is the HMAC-SHA256 of the exact body, keyed with the secret, in hex", async () => {
    await postSigned();

    const signature: string = headersOf()["X-OneUptime-Signature"] as string;

    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signature).toBe(hmac(SECRET, JSON.stringify(PAYLOAD)));
    expect(signature).toBe(
      signWebhookBody({
        secret: SECRET,
        body: JSON.stringify(PAYLOAD),
      }),
    );
  });

  test("signWebhookBody follows every byte of the body, and the secret", () => {
    expect(signWebhookBody({ secret: SECRET, body: '{"a":1}' })).not.toBe(
      signWebhookBody({ secret: SECRET, body: '{"a":2}' }),
    );
    expect(signWebhookBody({ secret: SECRET, body: '{"a":1}' })).not.toBe(
      signWebhookBody({ secret: "another-secret", body: '{"a":1}' }),
    );
  });

  test("the docs' verifier accepts it, and refuses a body changed in the slightest or another secret", async () => {
    await postSigned();

    const signature: string = headersOf()["X-OneUptime-Signature"] as string;
    const body: string = JSON.stringify(requestOf()["data"]);

    expect(isFromOneUptime(body, signature, SECRET)).toBe(true);
    expect(isFromOneUptime(body.replace("42", "43"), signature, SECRET)).toBe(
      false,
    );
    expect(isFromOneUptime(body, signature, "another-secret")).toBe(false);
    expect(isFromOneUptime(body, "", SECRET)).toBe(false);
  });

  test("a service with no secret is signed with an empty key, not left unsigned", async () => {
    await postSigned({ secret: "" });

    expect(headersOf()["X-OneUptime-Signature"]).toBe(
      hmac("", JSON.stringify(PAYLOAD)),
    );
  });

  test("the User-Agent is whatever the caller names: the gateway's is its own", async () => {
    await postSigned({ userAgent: CALL_AND_SMS_GATEWAY_USER_AGENT });

    expect(headersOf()["User-Agent"]).toBe("OneUptime-CallAndSmsGateway/1.0");

    post.mockClear();
    await postSigned({ userAgent: "OneUptime-CustomChannel/1.0" });

    expect(headersOf()["User-Agent"]).toBe("OneUptime-CustomChannel/1.0");
  });

  test("for payloads of every shape, the signature is of the very body sent, and verifies", async () => {
    const random: SeededRandom = seededRandom(2048);
    const words: Array<string> = [
      "Incident",
      "#42",
      "🚨",
      "é",
      '"quoted"',
      "back\\slash",
      "\n",
      "<b>",
      "&amp;",
      " ",
      String.fromCharCode(0x2028),
    ];

    for (let index: number = 0; index < 200; index++) {
      let message: string = "";
      const length: number = random(30);

      for (let position: number = 0; position < length; position++) {
        message += words[random(words.length)];
      }

      const payload: JSONObject = {
        version: 1,
        event: random(2) === 0 ? "sms" : "call",
        id: ObjectID.generate().toString(),
        to: `+1555${String(1000000 + random(8999999))}`,
        message: message,
        isSensitive: random(2) === 0,
        actions: random(2) === 0 ? null : { acknowledge: "https://x/a?t=1" },
      };
      const secret: string = random(4) === 0 ? "" : `secret-${random(1000)}`;

      post.mockClear();

      await postSigned({ payload, secret });

      const body: string = JSON.stringify(requestOf()["data"]);
      const signature: string = headersOf()["X-OneUptime-Signature"] as string;

      expect(body).toBe(JSON.stringify(payload));
      expect(signature).toBe(hmac(secret, body));
      expect(isFromOneUptime(body, signature, secret)).toBe(true);
    }
  });
});

describe("delivered", () => {
  test.each([200, 201, 202, 204, 299])(
    "HTTP %i on the first attempt: one attempt, no wait",
    async (status: number) => {
      post.mockResolvedValue(ok(status));

      expect(await postSigned()).toEqual({
        isDelivered: true,
        statusCode: status,
        error: undefined,
        attempts: 1,
      });
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  test("a service that recovers on the second attempt: two attempts, one wait of a second", async () => {
    post.mockResolvedValueOnce(refused(503)).mockResolvedValueOnce(ok(202));

    expect(await postSigned()).toEqual({
      isDelivered: true,
      statusCode: 202,
      error: undefined,
      attempts: 2,
    });
    expect(sleeps()).toEqual([1000]);
  });

  test("a service that answers on the third attempt, after two timeouts", async () => {
    post
      .mockRejectedValueOnce(new Error("timeout of 10000ms exceeded"))
      .mockRejectedValueOnce(new Error("timeout of 10000ms exceeded"))
      .mockResolvedValueOnce(ok(200));

    expect(await postSigned()).toEqual({
      isDelivered: true,
      statusCode: 200,
      error: undefined,
      attempts: 3,
    });
    expect(sleeps()).toEqual([1000, 4000]);
  });

  test("every attempt carries the same body and the same signature", async () => {
    post
      .mockResolvedValueOnce(refused(500))
      .mockResolvedValueOnce(refused(502))
      .mockResolvedValueOnce(ok(200));

    await postSigned();

    expect(post).toHaveBeenCalledTimes(3);

    for (const index of [1, 2]) {
      expect(requestOf(index)["data"]).toEqual(requestOf(0)["data"]);
      expect(headersOf(index)).toEqual(headersOf(0));
    }
  });
});

describe("tried again", () => {
  test.each([408, 429, 500, 501, 502, 503, 504, 599])(
    "HTTP %i: three attempts in all, waiting 1 and then 4 seconds",
    async (status: number) => {
      post.mockResolvedValue(refused(status));

      expect(await postSigned()).toEqual({
        isDelivered: false,
        statusCode: status,
        error: `HTTP ${status}`,
        attempts: SIGNED_WEBHOOK_MAX_ATTEMPTS,
      });
      expect(post).toHaveBeenCalledTimes(3);
      expect(sleeps()).toEqual([...SIGNED_WEBHOOK_RETRY_DELAYS_MS]);
      expect(sleeps()).toEqual([1000, 4000]);
    },
  );

  test("no answer at all: three attempts, and why the last one failed, for the server's log", async () => {
    post.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:443"));

    expect(await postSigned()).toEqual({
      isDelivered: false,
      statusCode: undefined,
      error: "connect ECONNREFUSED 10.0.0.5:443",
      attempts: 3,
    });
    expect(sleeps()).toEqual([1000, 4000]);
  });

  test("something thrown that is not an Error is still a reason", async () => {
    post.mockRejectedValue("socket hang up");

    const outcome: SignedPostOutcome = await postSigned();

    expect(outcome.error).toBe("socket hang up");
    expect(outcome.attempts).toBe(3);
  });

  test("an answer with no status is no answer: tried again, and no status is reported", async () => {
    post.mockResolvedValue(new HTTPErrorResponse(0, {}, {}));

    expect(await postSigned()).toEqual({
      isDelivered: false,
      statusCode: undefined,
      error: "HTTP 0",
      attempts: 3,
    });
  });

  test("the last attempt's answer is the one reported", async () => {
    post
      .mockResolvedValueOnce(refused(503))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(refused(502));

    expect(await postSigned()).toEqual({
      isDelivered: false,
      statusCode: 502,
      error: "HTTP 502",
      attempts: 3,
    });
  });

  test("never more than three attempts", async () => {
    post.mockResolvedValue(refused(503));

    await postSigned();
    await postSigned();

    expect(post).toHaveBeenCalledTimes(6);
  });
});

describe("not tried again", () => {
  test.each([400, 401, 403, 404, 405, 409, 410, 413, 415, 422, 451, 499])(
    "HTTP %i: the service refused it, and would again - one attempt, no wait",
    async (status: number) => {
      post.mockResolvedValue(refused(status));

      expect(await postSigned()).toEqual({
        isDelivered: false,
        statusCode: status,
        error: `HTTP ${status}`,
        attempts: 1,
      });
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  test("a redirect is not followed, and not tried again", async () => {
    post.mockResolvedValue(new HTTPResponse<JSONObject>(302, {}, {}));

    expect(await postSigned()).toEqual({
      isDelivered: false,
      statusCode: 302,
      error: "HTTP 302",
      attempts: 1,
    });
  });

  test("a refusal after a server error stops there", async () => {
    post
      .mockResolvedValueOnce(refused(503))
      .mockResolvedValueOnce(refused(401));

    expect(await postSigned()).toEqual({
      isDelivered: false,
      statusCode: 401,
      error: "HTTP 401",
      attempts: 2,
    });
    expect(sleeps()).toEqual([1000]);
  });
});

describe("the wait between attempts", () => {
  test("is a real wait of the time asked, a seam the tests stand in for", async () => {
    sleep.mockRestore();

    let pending: (() => void) | null = null;
    const timeout: jest.SpyInstance = jest
      .spyOn(global, "setTimeout")
      .mockImplementation(((callback: () => void): NodeJS.Timeout => {
        pending = callback;
        return 0 as unknown as NodeJS.Timeout;
      }) as never);

    let waited: boolean = false;
    const waiting: Promise<void> = SignedWebhookPost.sleep(4000).then(() => {
      waited = true;
    });

    await Promise.resolve();
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout.mock.calls[0]![1]).toBe(4000);
    expect(waited).toBe(false);

    // The time is up.
    (pending as unknown as () => void)();
    await waiting;
    expect(waited).toBe(true);
  });
});
