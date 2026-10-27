import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * SENDING A REQUEST TO A CUSTOM CHANNEL: CustomChannelSender.send.
 *
 * Core hands every request for a channel to the Enterprise Edition by the
 * channel's id (CustomNotificationChannelDeliveryService, through
 * CustomChannelSendAPI). The sender:
 *
 *   - asks again whether custom channels are active - the license can lapse
 *     between core's check and this one - and sends nothing while they are
 *     not;
 *   - reads the channel's URL and secret itself, as root, by its id;
 *   - never sends to a channel that is gone or turned off, unless an admin is
 *     testing it, nor a body larger than any request carries, nor to a URL
 *     the SSRF check refuses (private networks allowed: the admin's own
 *     service);
 *   - posts the request signed with the channel's secret and tried again
 *     while the service is down or slow (SignedWebhookPost, whose own suite
 *     covers the signing and the retries in full: here they are seen through
 *     the sender's words);
 *   - records how it went on the notification's on-call log row, and says it
 *     in words that never name the URL.
 *
 * Billing and the edition are pinned in every test (ee/README, "Working on
 * ee/"): CI's config.env sets BILLING_ENABLED=true.
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

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    EXTERNAL_FAULT: { externalFault: true },
  };
});

import CustomChannelSender, {
  CUSTOM_CHANNEL_USER_AGENT,
} from "../../../Server/CustomNotificationChannels/CustomChannelSender";
import SignedWebhookPost, {
  MAX_SIGNED_WEBHOOK_BODY_LENGTH,
  SIGNED_WEBHOOK_MAX_ATTEMPTS,
  SIGNED_WEBHOOK_REQUEST_TIMEOUT_MS,
  SIGNED_WEBHOOK_RETRY_DELAYS_MS,
} from "App/FeatureSet/Notification/Utils/SignedWebhookPost";
import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import { CustomChannelDeliveryResult } from "Common/Server/Services/CustomNotificationChannelDeliveryService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import { CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE } from "Common/Server/Utils/Notification/CustomChannelEdition";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import {
  CUSTOM_CHANNEL_EVENT_HEADER,
  CUSTOM_CHANNEL_SIGNATURE_HEADER,
} from "Common/Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import API from "Common/Utils/API";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "Common/Server/Enterprise/EnterpriseFeature";
import crypto from "crypto";

const CHANNEL_ID: ObjectID = new ObjectID(
  "c4a10000-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "c4a10000-0000-4000-8000-000000000002",
);
const HOST: string = "push.internal.example.com";
const URL_TEXT: string = `https://${HOST}/oneuptime/hook`;
const SECRET: string = "a".repeat(64);

const PAYLOAD: JSONObject = {
  version: 1,
  event: "on-call.incident.created",
  title: "New Incident INC-42",
};

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

function ok(status: number = 200): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(status, {}, {});
}

function refused(status: number): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: "nope" }, {});
}

let find: jest.SpiedFunction<
  typeof CustomNotificationChannelService.findOneById
>;
let post: jest.SpiedFunction<typeof API.post>;
let ssrf: jest.SpiedFunction<typeof SSRFProtection.validateWebhookTargetIsSafe>;
let updateTimeline: jest.SpiedFunction<
  typeof UserOnCallLogTimelineService.updateOneById
>;
let sleep: jest.SpiedFunction<typeof SignedWebhookPost.sleep>;

async function send(
  overrides: {
    isTest?: boolean;
    withTimeline?: boolean;
    payload?: JSONObject;
  } = {},
): Promise<CustomChannelDeliveryResult> {
  return await CustomChannelSender.send({
    customNotificationChannelId: CHANNEL_ID,
    eventType: "on-call.incident.created",
    payload: overrides.payload || PAYLOAD,
    isTest: overrides.isTest,
    userOnCallLogTimelineId:
      overrides.withTimeline === false ? undefined : TIMELINE_ID,
  });
}

// The one request the sender posted, as API.post was handed it.
function request(index: number = 0): Record<string, unknown> {
  return post.mock.calls[index]![0] as unknown as Record<string, unknown>;
}

function headersOf(index: number = 0): Record<string, string> {
  return request(index)["headers"] as Record<string, string>;
}

// What the sender wrote on the notification's on-call log row.
function timelineWrites(): Array<Record<string, unknown>> {
  return updateTimeline.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return call[0] as Record<string, unknown>;
    },
  );
}

beforeEach(() => {
  setTestBillingEnabled(false);
  installFakeEnterpriseModule();

  find = jest
    .spyOn(CustomNotificationChannelService, "findOneById")
    .mockResolvedValue(channel());
  post = jest.spyOn(API, "post").mockResolvedValue(ok() as never);
  ssrf = jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined as never);
  updateTimeline = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
  sleep = jest.spyOn(SignedWebhookPost, "sleep").mockResolvedValue(undefined);
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe("what is sent", () => {
  test("a JSON POST to the channel's URL, naming the event, as the custom channel's User-Agent, with a timeout and no redirects", async () => {
    await send();

    expect(post).toHaveBeenCalledTimes(1);
    expect(String(request()["url"])).toBe(URL_TEXT);
    expect(request()["data"]).toEqual(PAYLOAD);
    expect(headersOf()["Content-Type"]).toBe("application/json");
    expect(headersOf()[CUSTOM_CHANNEL_EVENT_HEADER]).toBe(
      "on-call.incident.created",
    );
    expect(headersOf()["User-Agent"]).toBe(CUSTOM_CHANNEL_USER_AGENT);
    expect(CUSTOM_CHANNEL_USER_AGENT).toBe("OneUptime-CustomChannel/1.0");
    expect(request()["options"]).toEqual({
      timeout: SIGNED_WEBHOOK_REQUEST_TIMEOUT_MS,
      doNotFollowRedirects: true,
    });
  });

  test("signed with the channel's own secret, over the exact body", async () => {
    await send();

    expect(headersOf()[CUSTOM_CHANNEL_SIGNATURE_HEADER]).toBe(
      `sha256=${crypto
        .createHmac("sha256", SECRET)
        .update(JSON.stringify(PAYLOAD))
        .digest("hex")}`,
    );
  });

  test("a channel saved without a secret is still signed, with an empty key, never left unsigned", async () => {
    const withoutSecret: CustomNotificationChannel = channel();
    // As a row read back with no secret stored: the column left unset.
    Object.assign(withoutSecret, { secret: undefined });
    find.mockResolvedValue(withoutSecret);

    await send();

    expect(headersOf()[CUSTOM_CHANNEL_SIGNATURE_HEADER]).toBe(
      `sha256=${crypto
        .createHmac("sha256", "")
        .update(JSON.stringify(PAYLOAD))
        .digest("hex")}`,
    );
  });

  test("the URL and the secret are read here, as root, by the channel's id, every time", async () => {
    await send();
    await send();

    expect(find).toHaveBeenCalledTimes(2);

    const call: Record<string, unknown> = find.mock
      .calls[0]![0] as unknown as Record<string, unknown>;

    expect((call["id"] as ObjectID).toString()).toBe(CHANNEL_ID.toString());
    expect(call["select"]).toEqual({
      _id: true,
      name: true,
      webhookUrl: true,
      secret: true,
      isEnabled: true,
    });
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("the URL is checked before anything is sent, allowing the private network the admin runs it on", async () => {
    await send();

    expect(ssrf).toHaveBeenCalledWith(URL_TEXT, {
      allowPrivateNetworkTargets: true,
    });
    expect(ssrf.mock.invocationCallOrder[0]!).toBeLessThan(
      post.mock.invocationCallOrder[0]!,
    );
  });
});

describe("delivered", () => {
  test.each([200, 201, 202, 204])(
    "HTTP %i is delivered, and the log row says so",
    async (status: number) => {
      post.mockResolvedValue(ok(status) as never);

      const result: CustomChannelDeliveryResult = await send();

      expect(result).toEqual({
        ok: true,
        statusCode: status,
        message: `Sent to CorpoApp (HTTP ${status}).`,
      });
      expect(timelineWrites()).toEqual([
        {
          id: TIMELINE_ID,
          data: {
            status: UserNotificationStatus.Sent,
            statusMessage: `Sent to CorpoApp (HTTP ${status}).`,
          },
          props: { isRoot: true },
        },
      ]);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  test("a test has no log row to update", async () => {
    const result: CustomChannelDeliveryResult = await send({
      isTest: true,
      withTimeline: false,
    });

    expect(result.ok).toBe(true);
    expect(updateTimeline).not.toHaveBeenCalled();
  });

  test("a channel with no name is called the custom channel", async () => {
    find.mockResolvedValue(channel({ name: "" }));

    const result: CustomChannelDeliveryResult = await send();

    expect(result.message).toBe("Sent to the custom channel (HTTP 200).");
  });
});

describe("tried again", () => {
  test.each([500, 502, 503, 504, 408, 429])(
    "HTTP %i is tried again, three attempts in all, waiting between them",
    async (status: number) => {
      post.mockResolvedValue(refused(status) as never);

      const result: CustomChannelDeliveryResult = await send();

      expect(post).toHaveBeenCalledTimes(SIGNED_WEBHOOK_MAX_ATTEMPTS);
      expect(
        sleep.mock.calls.map((call: Array<unknown>): unknown => {
          return call[0];
        }),
      ).toEqual([...SIGNED_WEBHOOK_RETRY_DELAYS_MS]);
      expect(result).toEqual({
        ok: false,
        statusCode: status,
        message: `Not delivered: CorpoApp answered HTTP ${status} (tried 3 times).`,
      });
    },
  );

  test("a service that recovers on the second attempt is delivered", async () => {
    post
      .mockResolvedValueOnce(refused(503) as never)
      .mockResolvedValueOnce(ok(200) as never);

    const result: CustomChannelDeliveryResult = await send();

    expect(post).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: true,
      statusCode: 200,
      message: "Sent to CorpoApp (HTTP 200).",
    });
    expect(timelineWrites()[0]).toMatchObject({
      data: { status: UserNotificationStatus.Sent },
    });
  });

  test("no answer at all is tried again, and said plainly", async () => {
    post.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:443"));

    const result: CustomChannelDeliveryResult = await send();

    expect(post).toHaveBeenCalledTimes(SIGNED_WEBHOOK_MAX_ATTEMPTS);
    expect(result).toEqual({
      ok: false,
      message: "Not delivered: CorpoApp could not be reached (tried 3 times).",
    });
  });

  test("an undelivered page is recorded as an error on its log row, in the words it answered", async () => {
    post.mockResolvedValue(refused(500) as never);

    await send();

    expect(timelineWrites()).toEqual([
      {
        id: TIMELINE_ID,
        data: {
          status: UserNotificationStatus.Error,
          statusMessage:
            "Not delivered: CorpoApp answered HTTP 500 (tried 3 times).",
        },
        props: { isRoot: true },
      },
    ]);
  });

  test("why it was not delivered goes to the server's log, as an external fault", async () => {
    post.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:443"));

    await send();

    expect(logger.error).toHaveBeenCalledWith(
      `Custom channel ${CHANNEL_ID.toString()} (CorpoApp): not delivered after 3 attempt(s). connect ECONNREFUSED 10.0.0.5:443`,
      EXTERNAL_FAULT,
    );
  });
});

describe("not tried again", () => {
  test.each([400, 401, 403, 404, 410, 422])(
    "HTTP %i: the service refused it, and would again",
    async (status: number) => {
      post.mockResolvedValue(refused(status) as never);

      const result: CustomChannelDeliveryResult = await send();

      expect(post).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(result).toEqual({
        ok: false,
        statusCode: status,
        message: `Not delivered: CorpoApp answered HTTP ${status}.`,
      });
    },
  );
});

describe("not sent", () => {
  test("a channel that no longer exists: nothing is checked or sent, and the log row says so", async () => {
    find.mockResolvedValue(null);

    const result: CustomChannelDeliveryResult = await send();

    expect(ssrf).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message: "Not sent: this custom channel no longer exists.",
    });
    expect(timelineWrites()[0]).toMatchObject({
      id: TIMELINE_ID,
      data: {
        status: UserNotificationStatus.Error,
        statusMessage: "Not sent: this custom channel no longer exists.",
      },
    });
  });

  test("a channel without a URL is one that no longer exists", async () => {
    find.mockResolvedValue(channel({ webhookUrl: "" }));

    const result: CustomChannelDeliveryResult = await send();

    expect(post).not.toHaveBeenCalled();
    expect(result.message).toBe(
      "Not sent: this custom channel no longer exists.",
    );
  });

  test("a channel that is turned off, saying where to turn it on", async () => {
    find.mockResolvedValue(channel({ isEnabled: false }));

    const result: CustomChannelDeliveryResult = await send();

    expect(post).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message:
        "Not sent: CorpoApp is turned off. Your administrator can turn it on in the Admin Dashboard, under Settings > Custom Channels.",
    });
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

  test("a URL the check refuses: nothing is sent, the reason goes to the server's log, and the answer names the channel, not the URL", async () => {
    ssrf.mockRejectedValue(
      new BadDataException(`${URL_TEXT} resolves to a blocked address.`),
    );

    const result: CustomChannelDeliveryResult = await send();

    expect(post).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message:
        "Not delivered: the URL of CorpoApp is not allowed. Your administrator can see why in the server's log.",
    });
    expect(logger.error).toHaveBeenCalledWith(
      `Custom channel ${CHANNEL_ID.toString()} (CorpoApp): its URL was refused.`,
      EXTERNAL_FAULT,
    );
  });

  test("a body larger than any request carries is never sent, nor its URL checked", async () => {
    const result: CustomChannelDeliveryResult = await send({
      payload: { huge: "x".repeat(MAX_SIGNED_WEBHOOK_BODY_LENGTH + 1) },
    });

    expect(ssrf).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message: `Not sent: the request for CorpoApp is longer than ${MAX_SIGNED_WEBHOOK_BODY_LENGTH} characters.`,
    });
  });

  test("the limit is on characters of the JSON, so text of many bytes per character still fits", async () => {
    // Each "é" is one character of the JSON and two bytes of UTF-8.
    const text: string = "é".repeat(MAX_SIGNED_WEBHOOK_BODY_LENGTH - 11);

    expect(JSON.stringify({ huge: text }).length).toBe(
      MAX_SIGNED_WEBHOOK_BODY_LENGTH,
    );
    expect(Buffer.byteLength(JSON.stringify({ huge: text }), "utf8")).toBe(
      2 * MAX_SIGNED_WEBHOOK_BODY_LENGTH - 11,
    );

    const result: CustomChannelDeliveryResult = await send({
      payload: { huge: text },
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  test("a body just inside the limit is sent", async () => {
    // {"huge":"…"} is eleven characters around the text.
    const result: CustomChannelDeliveryResult = await send({
      payload: { huge: "x".repeat(MAX_SIGNED_WEBHOOK_BODY_LENGTH - 11) },
    });

    expect(
      JSON.stringify({ huge: "x".repeat(MAX_SIGNED_WEBHOOK_BODY_LENGTH - 11) })
        .length,
    ).toBe(MAX_SIGNED_WEBHOOK_BODY_LENGTH);
    expect(post).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });
});

describe("nothing people read names the URL", () => {
  test.each([
    ["delivered", (): void => {}],
    [
      "refused",
      (): void => {
        post.mockResolvedValue(refused(401) as never);
      },
    ],
    [
      "down",
      (): void => {
        post.mockResolvedValue(refused(503) as never);
      },
    ],
    [
      "unreachable",
      (): void => {
        post.mockRejectedValue(new Error(`getaddrinfo ENOTFOUND ${HOST}`));
      },
    ],
    [
      "refused by the URL check",
      (): void => {
        ssrf.mockRejectedValue(
          new BadDataException(`${URL_TEXT} resolves to 10.0.0.5.`),
        );
      },
    ],
  ])("when %s", async (_case: string, arrange: () => void) => {
    arrange();

    const result: CustomChannelDeliveryResult = await send();

    expect(result.message).not.toContain(HOST);

    for (const write of timelineWrites()) {
      expect(JSON.stringify(write)).not.toContain(HOST);
    }
  });
});

describe("asked again whether custom channels are active", () => {
  test("on the Community Edition nothing is read, checked or sent, and the log row says why", async () => {
    uninstallEnterpriseModule();

    const result: CustomChannelDeliveryResult = await send();

    expect(result).toEqual({
      ok: false,
      message: CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
    });
    expect(find).not.toHaveBeenCalled();
    expect(ssrf).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(timelineWrites()).toEqual([
      {
        id: TIMELINE_ID,
        data: {
          status: UserNotificationStatus.Error,
          statusMessage: CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
        },
        props: { isRoot: true },
      },
    ]);
  });

  test("a license that lapsed after core handed the request over: nothing is sent; once it is renewed, the next one is, with no restart", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));

    expect(await send()).toEqual({
      ok: false,
      message: CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
    });
    expect(post).not.toHaveBeenCalled();

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));

    expect((await send()).ok).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("a license that leaves custom channels out sends nothing, even a test", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: ALL_ENTERPRISE_FEATURES.filter(
          (feature: EnterpriseFeature): boolean => {
            return feature !== EnterpriseFeature.CustomNotificationChannels;
          },
        ),
      }),
    });

    const result: CustomChannelDeliveryResult = await send({
      isTest: true,
      withTimeline: false,
    });

    expect(result.message).toBe(CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE);
    expect(post).not.toHaveBeenCalled();
    expect(updateTimeline).not.toHaveBeenCalled();
  });

  test("a license that names custom channels alone is enough", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: [EnterpriseFeature.CustomNotificationChannels],
      }),
    });

    expect((await send()).ok).toBe(true);
  });

  test.each(
    createEditionStateCases().map(
      (state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      },
    ),
  )("%s", async (_label: string, state: EditionStateCase) => {
    state.apply();

    const result: CustomChannelDeliveryResult = await send();

    expect({
      sent: post.mock.calls.length > 0,
      ok: result.ok,
    }).toEqual({ sent: state.isActive, ok: state.isActive });

    if (!state.isActive) {
      expect(result.message).toBe(CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE);
      expect(find).not.toHaveBeenCalled();
    }
  });
});
