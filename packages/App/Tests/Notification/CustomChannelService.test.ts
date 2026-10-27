import CustomChannelService, {
  CUSTOM_CHANNEL_MAX_ATTEMPTS,
  CUSTOM_CHANNEL_REQUEST_TIMEOUT_MS,
  CUSTOM_CHANNEL_RETRY_DELAYS_MS,
  MAX_CUSTOM_CHANNEL_BODY_LENGTH,
  isRetryableStatus,
  signCustomChannelBody,
} from "../../FeatureSet/Notification/Services/CustomChannelService";
import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import { CustomChannelDeliveryResult } from "Common/Server/Services/CustomNotificationChannelDeliveryService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
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
 * Sending a request to a custom channel: signed with the channel's secret,
 * tried again while the service is down or slow and not when it refused,
 * never sent to a channel that is off (unless the admin is testing it), and
 * recorded where people read it without ever naming the URL.
 */

const CHANNEL_ID: ObjectID = ObjectID.generate();
const TIMELINE_ID: ObjectID = ObjectID.generate();
const URL_TEXT: string = "https://push.internal.example.com/oneuptime/hook";
const SECRET: string = "a".repeat(64);

function channel(
  overrides: Partial<CustomNotificationChannel> = {},
): CustomNotificationChannel {
  const row: CustomNotificationChannel = new CustomNotificationChannel();
  row._id = CHANNEL_ID.toString();
  row.name = "CorpoApp";
  row.webhookUrl = URL_TEXT;
  row.secret = SECRET;
  row.isEnabled = true;
  Object.assign(row, overrides);
  return row;
}

let find: jest.SpyInstance;
let post: jest.SpyInstance;
let ssrf: jest.SpyInstance;
let updateTimeline: jest.SpyInstance;
let sleep: jest.SpyInstance;

function ok(status: number = 200): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(status, {}, {});
}

function refused(status: number): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: "nope" }, {});
}

const PAYLOAD: JSONObject = {
  version: 1,
  event: "on-call.incident.created",
  title: "New Incident INC-42",
};

async function send(
  overrides: { isTest?: boolean; withTimeline?: boolean } = {},
): Promise<CustomChannelDeliveryResult> {
  return await CustomChannelService.send({
    customNotificationChannelId: CHANNEL_ID,
    eventType: "on-call.incident.created",
    payload: PAYLOAD,
    isTest: overrides.isTest,
    userOnCallLogTimelineId:
      overrides.withTimeline === false ? undefined : TIMELINE_ID,
  });
}

beforeEach(() => {
  find = jest
    .spyOn(CustomNotificationChannelService, "findOneById")
    .mockResolvedValue(channel());
  post = jest.spyOn(API, "post").mockResolvedValue(ok());
  ssrf = jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined);
  updateTimeline = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
  sleep = jest.spyOn(CustomChannelService, "sleep").mockResolvedValue();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what is sent", () => {
  test("a JSON POST to the channel's URL, with the event and a timeout", async () => {
    await send();

    expect(post).toHaveBeenCalledTimes(1);
    const request: Record<string, unknown> = post.mock.calls[0]![0] as never;
    const headers: Record<string, string> = request["headers"] as Record<
      string,
      string
    >;

    expect(request["url"]!.toString()).toBe(URL_TEXT);
    expect(request["data"]).toEqual(PAYLOAD);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-OneUptime-Event"]).toBe("on-call.incident.created");
    expect(headers["User-Agent"]).toContain("OneUptime");
    expect(request["options"]).toEqual({
      timeout: CUSTOM_CHANNEL_REQUEST_TIMEOUT_MS,
      doNotFollowRedirects: true,
    });
  });

  test("signed with the channel's secret over the exact body", async () => {
    await send();

    const headers: Record<string, string> = (
      post.mock.calls[0]![0] as Record<string, unknown>
    )["headers"] as Record<string, string>;

    const expected: string =
      "sha256=" +
      crypto
        .createHmac("sha256", SECRET)
        .update(JSON.stringify(PAYLOAD))
        .digest("hex");

    expect(headers["X-OneUptime-Signature"]).toBe(expected);
  });

  test("the signature a service computes with the wrong secret does not match", () => {
    const body: string = JSON.stringify(PAYLOAD);

    expect(signCustomChannelBody({ secret: SECRET, body: body })).not.toBe(
      signCustomChannelBody({ secret: "another-secret", body: body }),
    );
  });

  test("the signature follows every byte of the body", () => {
    expect(signCustomChannelBody({ secret: SECRET, body: '{"a":1}' })).not.toBe(
      signCustomChannelBody({ secret: SECRET, body: '{"a":2}' }),
    );
  });

  test("the URL is read as root, by the channel id, every time", async () => {
    await send();

    const call: Record<string, unknown> = find.mock.calls[0]![0] as never;
    expect((call["id"] as ObjectID).toString()).toBe(CHANNEL_ID.toString());
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("the URL is checked before sending, allowing a private network", async () => {
    await send();

    expect(ssrf).toHaveBeenCalledWith(URL_TEXT, {
      allowPrivateNetworkTargets: true,
    });
  });
});

describe("delivered", () => {
  test.each([200, 201, 202, 204])(
    "HTTP %i is delivered, and the log row says so",
    async (status: number) => {
      post.mockResolvedValue(ok(status));

      const result: CustomChannelDeliveryResult = await send();

      expect(result).toEqual({
        ok: true,
        statusCode: status,
        message: `Sent to CorpoApp (HTTP ${status}).`,
      });
      expect(updateTimeline).toHaveBeenCalledWith({
        id: TIMELINE_ID,
        data: {
          status: UserNotificationStatus.Sent,
          statusMessage: `Sent to CorpoApp (HTTP ${status}).`,
        },
        props: { isRoot: true },
      });
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  test("a test has no log row to update", async () => {
    await send({ isTest: true, withTimeline: false });

    expect(updateTimeline).not.toHaveBeenCalled();
  });
});

describe("tried again", () => {
  test.each([500, 502, 503, 504, 408, 429])(
    "HTTP %i is tried again, three attempts in all, waiting between them",
    async (status: number) => {
      post.mockResolvedValue(refused(status));

      const result: CustomChannelDeliveryResult = await send();

      expect(post).toHaveBeenCalledTimes(CUSTOM_CHANNEL_MAX_ATTEMPTS);
      expect(
        sleep.mock.calls.map((call: Array<unknown>) => {
          return call[0];
        }),
      ).toEqual([...CUSTOM_CHANNEL_RETRY_DELAYS_MS]);
      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(status);
      expect(result.message).toBe(
        `Not delivered: CorpoApp answered HTTP ${status} (tried 3 times).`,
      );
    },
  );

  test("a service that recovers on the second attempt is delivered", async () => {
    post.mockResolvedValueOnce(refused(503)).mockResolvedValueOnce(ok(200));

    const result: CustomChannelDeliveryResult = await send();

    expect(post).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(updateTimeline.mock.calls[0]![0]).toMatchObject({
      data: { status: UserNotificationStatus.Sent },
    });
  });

  test("no answer at all is tried again, and said plainly", async () => {
    post.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:443"));

    const result: CustomChannelDeliveryResult = await send();

    expect(post).toHaveBeenCalledTimes(CUSTOM_CHANNEL_MAX_ATTEMPTS);
    expect(result).toEqual({
      ok: false,
      message: "Not delivered: CorpoApp could not be reached (tried 3 times).",
    });
  });

  test("an undelivered page is recorded as an error on its log row", async () => {
    post.mockResolvedValue(refused(500));

    await send();

    expect(updateTimeline.mock.calls[0]![0]).toMatchObject({
      id: TIMELINE_ID,
      data: { status: UserNotificationStatus.Error },
    });
  });

  test("the waits are 1 then 4 seconds", () => {
    expect([...CUSTOM_CHANNEL_RETRY_DELAYS_MS]).toEqual([1000, 4000]);
    expect(CUSTOM_CHANNEL_MAX_ATTEMPTS).toBe(3);
    expect(CUSTOM_CHANNEL_REQUEST_TIMEOUT_MS).toBe(10000);
  });
});

describe("not tried again", () => {
  test.each([400, 401, 403, 404, 410, 422])(
    "HTTP %i: the service refused it, and would again",
    async (status: number) => {
      post.mockResolvedValue(refused(status));

      const result: CustomChannelDeliveryResult = await send();

      expect(post).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(result.message).toBe(
        `Not delivered: CorpoApp answered HTTP ${status}.`,
      );
    },
  );

  test.each([
    [400, false],
    [404, false],
    [408, true],
    [429, true],
    [500, true],
    [599, true],
  ])("HTTP %i is worth retrying: %p", (status: number, expected: boolean) => {
    expect(isRetryableStatus(status)).toBe(expected);
  });
});

describe("not sent", () => {
  test("a channel that no longer exists", async () => {
    find.mockResolvedValue(null);

    const result: CustomChannelDeliveryResult = await send();

    expect(post).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message: "Not sent: this custom channel no longer exists.",
    });
    expect(updateTimeline.mock.calls[0]![0]).toMatchObject({
      data: { status: UserNotificationStatus.Error },
    });
  });

  test("a channel that is turned off", async () => {
    find.mockResolvedValue(channel({ isEnabled: false }));

    const result: CustomChannelDeliveryResult = await send();

    expect(post).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("CorpoApp is turned off");
  });

  test("but a test of a channel that is turned off is sent: the admin is trying it", async () => {
    find.mockResolvedValue(channel({ isEnabled: false }));

    const result: CustomChannelDeliveryResult = await send({
      isTest: true,
      withTimeline: false,
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  test("a URL the check refuses, without naming the URL", async () => {
    ssrf.mockRejectedValue(
      new BadDataException(`${URL_TEXT} resolves to a blocked address.`),
    );

    const result: CustomChannelDeliveryResult = await send();

    expect(post).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("CorpoApp");
    expect(result.message).not.toContain("push.internal.example.com");
  });

  test("a body larger than any request carries", async () => {
    const result: CustomChannelDeliveryResult = await CustomChannelService.send(
      {
        customNotificationChannelId: CHANNEL_ID,
        eventType: "on-call.incident.created",
        payload: { huge: "x".repeat(MAX_CUSTOM_CHANNEL_BODY_LENGTH + 1) },
      },
    );

    expect(post).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});

describe("nothing people read names the URL", () => {
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
        post.mockRejectedValue(
          new Error(`getaddrinfo ENOTFOUND push.internal.example.com`),
        );
      },
    ],
  ])("when %s", async (_case: string, arrange: () => void) => {
    arrange();

    const result: CustomChannelDeliveryResult = await send();

    expect(result.message).not.toContain("push.internal.example.com");
    expect(result.message).not.toContain(URL_TEXT);

    for (const call of updateTimeline.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain(
        "push.internal.example.com",
      );
    }
  });
});
