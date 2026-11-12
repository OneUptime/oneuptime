import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * HOW EVERY REQUEST TO A CUSTOM CHANNEL WENT, FOR THE PLATFORM'S OPERATOR
 * (issue #6600).
 *
 * An installation's custom channels co-exist with Twilio, Expo and the
 * rest, and the operator holds each to an SLO of its own: every request the
 * Enterprise Edition's sender handles is recorded once
 * (notification.send.count and .duration) under the channel's id and name -
 * delivered, not delivered, or deliberately not sent (the channel is off,
 * gone, or there is no license). A test its admin sends is not counted, and
 * a request that throws is left to core, which counts it as failed when it
 * gets no answer. CustomChannelSender and SignedWebhookPost run as they
 * are; the network, the database and the metrics SDK are stood in for.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const sendCounterCalls: Array<RecordedCall> = [];
const sendDurationCalls: Array<RecordedCall> = [];

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            sendCounterCalls.push({ value, attributes });
          },
        };
      },
      getNotificationDuration: () => {
        return {
          record: (value: number, attributes: Record<string, string>): void => {
            sendDurationCalls.push({ value, attributes });
          },
        };
      },
    },
  };
});

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

import CustomChannelSender from "../../../Server/CustomNotificationChannels/CustomChannelSender";
import SignedWebhookPost from "App/FeatureSet/Notification/Utils/SignedWebhookPost";
import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import OnCallTimelineRows from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import API from "Common/Utils/API";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

const CHANNEL_ID: ObjectID = new ObjectID(
  "66004444-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "66004444-0000-4000-8000-000000000002",
);

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
  row.webhookUrl = "https://push.internal.example.com/oneuptime/hook";
  row.secret = "a".repeat(64);
  row.isEnabled = true;
  Object.assign(row, overrides);
  return row;
}

let find: jest.SpiedFunction<
  typeof CustomNotificationChannelService.findOneById
>;
let post: jest.SpiedFunction<typeof API.post>;
let ssrf: jest.SpiedFunction<typeof SSRFProtection.validateWebhookTargetIsSafe>;

async function send(
  overrides: { isTest?: boolean; withTimeline?: boolean } = {},
): Promise<void> {
  await CustomChannelSender.send({
    customNotificationChannelId: CHANNEL_ID,
    eventType: "on-call.incident.created",
    payload: PAYLOAD,
    isTest: overrides.isTest,
    userOnCallLogTimelineId:
      overrides.withTimeline === false ? undefined : TIMELINE_ID,
  });
}

function onlySend(): Record<string, string> {
  expect(sendCounterCalls).toHaveLength(1);
  expect(sendCounterCalls[0]!.value).toBe(1);
  expect(sendDurationCalls).toHaveLength(1);
  expect(sendDurationCalls[0]!.attributes).toEqual(
    sendCounterCalls[0]!.attributes,
  );
  return sendCounterCalls[0]!.attributes;
}

beforeEach(() => {
  sendCounterCalls.length = 0;
  sendDurationCalls.length = 0;
  setTestBillingEnabled(false);
  installFakeEnterpriseModule();

  find = jest
    .spyOn(CustomNotificationChannelService, "findOneById")
    .mockResolvedValue(channel());
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}) as never);
  ssrf = jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined as never);
  // The notification's on-call log row, written over Sending only.
  const timeline: OnCallTimelineRows = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
  jest.spyOn(SignedWebhookPost, "sleep").mockResolvedValue(undefined);
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe("a request to a custom channel", () => {
  test("delivered: a success under the channel's id and name", async () => {
    await send();

    expect(onlySend()).toEqual({
      "notification.channel": "custom_channel",
      "notification.provider": "custom_channel",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      "notification.custom_channel.id": CHANNEL_ID.toString(),
      "notification.custom_channel.name": "CorpoApp",
      outcome: "success",
    });
  });

  test("not for an on-call page - an owner's notification - says so", async () => {
    await send({ withTimeline: false });

    expect(onlySend()["notification.on_call_page"]).toBe("false");
  });

  test("its service answered an error, every attempt: a failure", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(503, { message: "busy" }, {}) as never,
    );

    await send();

    expect(post.mock.calls.length).toBeGreaterThan(1);
    expect(onlySend()).toMatchObject({
      "notification.custom_channel.id": CHANNEL_ID.toString(),
      "notification.custom_channel.name": "CorpoApp",
      outcome: "failure",
    });
  });

  test("its URL is refused: a failure", async () => {
    ssrf.mockRejectedValue(new Error("Private network target") as never);

    await send();

    expect(post).not.toHaveBeenCalled();
    expect(onlySend()["outcome"]).toBe("failure");
  });

  test("turned off by its admin: not sent", async () => {
    find.mockResolvedValue(channel({ isEnabled: false }));

    await send();

    expect(post).not.toHaveBeenCalled();
    expect(onlySend()).toMatchObject({
      "notification.custom_channel.name": "CorpoApp",
      outcome: "not_sent",
    });
  });

  test("deleted since: not sent, by its id alone", async () => {
    find.mockResolvedValue(null);

    await send();

    const attributes: Record<string, string> = onlySend();

    expect(attributes["outcome"]).toBe("not_sent");
    expect(attributes["notification.custom_channel.id"]).toBe(
      CHANNEL_ID.toString(),
    );
    expect("notification.custom_channel.name" in attributes).toBe(false);
  });

  test("no Enterprise license any more: not sent, and the channel is not even read", async () => {
    uninstallEnterpriseModule();

    await send();

    expect(find).not.toHaveBeenCalled();
    expect(onlySend()["outcome"]).toBe("not_sent");
  });

  test("a test its admin sends is not counted, delivered or not", async () => {
    await send({ isTest: true });

    find.mockResolvedValue(channel({ isEnabled: false }));
    await send({ isTest: true });

    post.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "nope" }, {}) as never,
    );
    await send({ isTest: true });

    expect(sendCounterCalls).toEqual([]);
    expect(sendDurationCalls).toEqual([]);
  });

  test("a request that throws is left to core to count, not counted twice", async () => {
    find.mockRejectedValue(new Error("connection reset"));

    await expect(send()).rejects.toThrow("connection reset");

    expect(sendCounterCalls).toEqual([]);
  });
});
