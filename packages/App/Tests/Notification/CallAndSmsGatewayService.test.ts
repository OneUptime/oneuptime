import CallAndSmsGatewayService, {
  CALL_AND_SMS_GATEWAY_NAME,
  CALL_AND_SMS_GATEWAY_NOT_SET_UP_MESSAGE,
  CALL_AND_SMS_GATEWAY_USER_AGENT,
  CallAndSmsGatewayResult,
} from "../../FeatureSet/Notification/Services/CallAndSmsGatewayService";
import SignedWebhookPost, {
  MAX_SIGNED_WEBHOOK_BODY_LENGTH,
} from "../../FeatureSet/Notification/Utils/SignedWebhookPost";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import logger from "Common/Server/Utils/Logger";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { CallAndSmsGateway } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import {
  CallAndSmsGatewayEvent,
  buildCallAndSmsGatewayMessagePayload,
} from "Common/Types/CallAndSMS/CallAndSmsGatewayPayload";
import BadDataException from "Common/Types/Exception/BadDataException";
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

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    getCallAndSmsGateway: jest.fn(),
  };
});

import { getCallAndSmsGateway } from "../../FeatureSet/Notification/Config";

/*
 * SENDING AN SMS OR A CALL THROUGH THE SERVER'S OWN GATEWAY.
 *
 * One signed JSON request per SMS or call, to the gateway's URL - checked
 * first, the installation's private network allowed - and tried again as a
 * custom channel's request is (SignedWebhookPost). What it
 * answers is written where the project's members read it - the SMS or call
 * log, the on-call log row, a test's answer - so it names the gateway and
 * the HTTP status, and never the URL, which is the installation admin's.
 */

const GATEWAY: CallAndSmsGateway = {
  url: "https://sms-gateway.internal.example.com/oneuptime",
  secret: "9".repeat(64),
};

const HOST: string = "sms-gateway.internal.example.com";

const PAYLOAD: JSONObject = buildCallAndSmsGatewayMessagePayload({
  event: CallAndSmsGatewayEvent.Sms,
  id: "7c5b0d0e-3e5f-4d1a-9a4f-2b8e6c1d9f00",
  sentAt: new Date("2026-10-27T09:30:00.000Z"),
  to: "+15551234567",
  message: "Incident #42: Database is down",
  isSensitive: false,
});

let post: jest.SpyInstance;
let ssrf: jest.SpyInstance;
let sleep: jest.SpyInstance;

function ok(status: number = 200): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(status, {}, {});
}

function refused(status: number): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: "nope" }, {});
}

async function send(
  overrides: Partial<{
    gateway: CallAndSmsGateway;
    event: CallAndSmsGatewayEvent;
    payload: JSONObject;
  }> = {},
): Promise<CallAndSmsGatewayResult> {
  return await CallAndSmsGatewayService.send({
    gateway: GATEWAY,
    event: CallAndSmsGatewayEvent.Sms,
    payload: PAYLOAD,
    ...overrides,
  });
}

function headersOf(index: number = 0): Record<string, string> {
  return (post.mock.calls[index]![0] as Record<string, unknown>)[
    "headers"
  ] as Record<string, string>;
}

beforeEach(() => {
  post = jest.spyOn(API, "post").mockResolvedValue(ok());
  ssrf = jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined);
  sleep = jest.spyOn(SignedWebhookPost, "sleep").mockResolvedValue();
  (logger.error as unknown as jest.Mock).mockClear();
  (getCallAndSmsGateway as unknown as jest.Mock).mockReset();
  (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(GATEWAY);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the gateway's name and User-Agent", () => {
  test("is named in words, never by its URL", () => {
    expect(CALL_AND_SMS_GATEWAY_NAME).toBe("the SMS and call gateway");
    expect(CALL_AND_SMS_GATEWAY_USER_AGENT).toBe(
      "OneUptime-CallAndSmsGateway/1.0",
    );
  });
});

describe("what is sent", () => {
  test("one signed POST to the gateway's URL, as the gateway's own User-Agent, naming the event", async () => {
    await send({ event: CallAndSmsGatewayEvent.Call });

    expect(post).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = post.mock.calls[0]![0] as never;

    expect(request["url"]!.toString()).toBe(GATEWAY.url);
    expect(request["data"]).toEqual(PAYLOAD);
    expect(headersOf()).toEqual({
      "Content-Type": "application/json",
      "User-Agent": "OneUptime-CallAndSmsGateway/1.0",
      "X-OneUptime-Event": "call",
      "X-OneUptime-Signature": `sha256=${crypto
        .createHmac("sha256", GATEWAY.secret)
        .update(JSON.stringify(PAYLOAD))
        .digest("hex")}`,
    });
  });

  test("through SignedWebhookPost, so it is signed and tried again as a custom channel's is", async () => {
    const signed: jest.SpyInstance = jest.spyOn(SignedWebhookPost, "post");

    await send();

    expect(signed).toHaveBeenCalledTimes(1);
    expect(signed.mock.calls[0]![0]).toEqual({
      url: GATEWAY.url,
      secret: GATEWAY.secret,
      eventType: "sms",
      payload: PAYLOAD,
      userAgent: CALL_AND_SMS_GATEWAY_USER_AGENT,
    });
  });

  test("the URL is checked before anything is sent, with the installation's private network allowed", async () => {
    await send();

    expect(ssrf).toHaveBeenCalledTimes(1);
    expect(ssrf).toHaveBeenCalledWith(GATEWAY.url, {
      allowPrivateNetworkTargets: true,
    });
    expect(ssrf.mock.invocationCallOrder[0]!).toBeLessThan(
      post.mock.invocationCallOrder[0]!,
    );
  });
});

describe("delivered", () => {
  test.each([200, 201, 202, 204])(
    "HTTP %i: sent, with the status",
    async (status: number) => {
      post.mockResolvedValue(ok(status));

      expect(await send()).toEqual({
        ok: true,
        statusCode: status,
        message: `Sent to the SMS and call gateway (HTTP ${status}).`,
      });
    },
  );

  test("a gateway that recovers on the second attempt is delivered", async () => {
    post.mockResolvedValueOnce(refused(503)).mockResolvedValueOnce(ok(200));

    expect(await send()).toEqual({
      ok: true,
      statusCode: 200,
      message: "Sent to the SMS and call gateway (HTTP 200).",
    });
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe("not delivered", () => {
  test.each([500, 502, 503, 504, 408, 429])(
    "HTTP %i: tried three times, and says so",
    async (status: number) => {
      post.mockResolvedValue(refused(status));

      expect(await send()).toEqual({
        ok: false,
        statusCode: status,
        message: `Not delivered: the SMS and call gateway answered HTTP ${status} (tried 3 times).`,
      });
      expect(post).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
    },
  );

  test.each([400, 401, 403, 404, 422])(
    "HTTP %i: refused once, and not tried again",
    async (status: number) => {
      post.mockResolvedValue(refused(status));

      expect(await send()).toEqual({
        ok: false,
        statusCode: status,
        message: `Not delivered: the SMS and call gateway answered HTTP ${status}.`,
      });
      expect(post).toHaveBeenCalledTimes(1);
    },
  );

  test("a gateway that cannot be reached: tried three times, no status", async () => {
    post.mockRejectedValue(new Error(`getaddrinfo ENOTFOUND ${HOST}`));

    expect(await send()).toEqual({
      ok: false,
      message:
        "Not delivered: the SMS and call gateway could not be reached (tried 3 times).",
    });
  });

  test("the server's log has the reason and the attempts, for the admin", async () => {
    post.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:443"));

    await send({ event: CallAndSmsGatewayEvent.Call });

    const logged: string = (logger.error as unknown as jest.Mock).mock.calls
      .map((call: Array<unknown>) => {
        return String(call[0]);
      })
      .join("\n");

    expect(logged).toContain(
      "SMS and call gateway: a call request was not delivered after 3 attempt(s).",
    );
    expect(logged).toContain("connect ECONNREFUSED 10.0.0.5:443");
  });
});

describe("not sent", () => {
  test("a request larger than any request carries is not sent, nor its URL checked", async () => {
    const result: CallAndSmsGatewayResult = await send({
      payload: { message: "x".repeat(MAX_SIGNED_WEBHOOK_BODY_LENGTH + 1) },
    });

    expect(result).toEqual({
      ok: false,
      message: `Not sent: the request for the SMS and call gateway is larger than ${MAX_SIGNED_WEBHOOK_BODY_LENGTH} bytes.`,
    });
    expect(post).not.toHaveBeenCalled();
    expect(ssrf).not.toHaveBeenCalled();
  });

  test("a request just within the limit is sent", async () => {
    const payload: JSONObject = { message: "" };
    const overhead: number = JSON.stringify(payload).length;
    payload["message"] = "x".repeat(MAX_SIGNED_WEBHOOK_BODY_LENGTH - overhead);

    expect(JSON.stringify(payload).length).toBe(MAX_SIGNED_WEBHOOK_BODY_LENGTH);

    expect((await send({ payload })).ok).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("a URL the check refuses is not posted to, and the answer does not name it", async () => {
    ssrf.mockRejectedValue(
      new BadDataException(`${GATEWAY.url} resolves to a blocked address.`),
    );

    const result: CallAndSmsGatewayResult = await send();

    expect(result).toEqual({
      ok: false,
      message:
        "Not delivered: the URL of the SMS and call gateway is not allowed. Your administrator can see why in the server's log.",
    });
    expect(post).not.toHaveBeenCalled();
    // The server's log has why, for the admin.
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("nothing people read names the gateway's URL", () => {
  test.each([
    ["delivered", (): void => {}],
    [
      "refused",
      (): void => {
        post.mockResolvedValue(refused(401));
      },
    ],
    [
      "down",
      (): void => {
        post.mockResolvedValue(refused(503));
      },
    ],
    [
      "unreachable",
      (): void => {
        post.mockRejectedValue(new Error(`getaddrinfo ENOTFOUND ${HOST}`));
      },
    ],
    [
      "refused by the check",
      (): void => {
        ssrf.mockRejectedValue(new BadDataException(`${GATEWAY.url} blocked`));
      },
    ],
  ])("when %s", async (_case: string, arrange: () => void) => {
    arrange();

    const result: CallAndSmsGatewayResult = await send();

    expect(result.message).not.toContain(HOST);
    expect(result.message).not.toContain(GATEWAY.url);
    expect(result.message).not.toContain(GATEWAY.secret);
    expect(result.message).toContain(CALL_AND_SMS_GATEWAY_NAME);
  });
});

describe("Send test", () => {
  test("on a server that sends through Twilio says so, and sends nothing", async () => {
    (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(null);

    expect(await CallAndSmsGatewayService.sendTest()).toEqual({
      ok: false,
      message: CALL_AND_SMS_GATEWAY_NOT_SET_UP_MESSAGE,
    });
    expect(CALL_AND_SMS_GATEWAY_NOT_SET_UP_MESSAGE).toBe(
      "Not sent: this server sends SMS and calls through Twilio. Choose your own gateway, add its Gateway URL and save, then send a test.",
    );
    expect(post).not.toHaveBeenCalled();
    expect(ssrf).not.toHaveBeenCalled();
  });

  test("posts one test request to the gateway as saved: to nobody, with nothing to act on", async () => {
    const result: CallAndSmsGatewayResult =
      await CallAndSmsGatewayService.sendTest();

    expect(getCallAndSmsGateway).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      statusCode: 200,
      message: "Sent to the SMS and call gateway (HTTP 200).",
    });

    const request: Record<string, unknown> = post.mock.calls[0]![0] as never;
    const data: JSONObject = request["data"] as JSONObject;

    expect(request["url"]!.toString()).toBe(GATEWAY.url);
    expect(headersOf()["X-OneUptime-Event"]).toBe("test");
    expect(data["version"]).toBe(1);
    expect(data["event"]).toBe("test");
    expect(data["to"]).toBeNull();
    expect(data["project"]).toBeNull();
    expect(data["actions"]).toBeNull();
    expect(data["isSensitive"]).toBe(false);
    expect(ObjectID.isValidUUID(data["id"] as string)).toBe(true);
    expect(
      Math.abs(Date.parse(data["sentAt"] as string) - Date.now()),
    ).toBeLessThan(60_000);
    expect(headersOf()["X-OneUptime-Signature"]).toBe(
      `sha256=${crypto
        .createHmac("sha256", GATEWAY.secret)
        .update(JSON.stringify(data))
        .digest("hex")}`,
    );
  });

  test("each test has an id of its own", async () => {
    await CallAndSmsGatewayService.sendTest();
    await CallAndSmsGatewayService.sendTest();

    const first: JSONObject = (
      post.mock.calls[0]![0] as Record<string, unknown>
    )["data"] as JSONObject;
    const second: JSONObject = (
      post.mock.calls[1]![0] as Record<string, unknown>
    )["data"] as JSONObject;

    expect(first["id"]).not.toBe(second["id"]);
  });

  test("a test the gateway refused says what it answered", async () => {
    post.mockResolvedValue(refused(401));

    expect(await CallAndSmsGatewayService.sendTest()).toEqual({
      ok: false,
      statusCode: 401,
      message: "Not delivered: the SMS and call gateway answered HTTP 401.",
    });
  });

  test("a gateway URL refused by the check is not posted to", async () => {
    ssrf.mockRejectedValue(new BadDataException("blocked"));

    const result: CallAndSmsGatewayResult =
      await CallAndSmsGatewayService.sendTest();

    expect(result.ok).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  test("a read of the gateway that fails fails the test, rather than claiming Twilio", async () => {
    (getCallAndSmsGateway as unknown as jest.Mock).mockRejectedValue(
      new Error("connection terminated"),
    );

    await expect(CallAndSmsGatewayService.sendTest()).rejects.toThrow(
      "connection terminated",
    );
    expect(post).not.toHaveBeenCalled();
  });
});
