import WebhookService from "../../FeatureSet/Notification/Services/WebhookService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import WebhookLogService from "Common/Server/Services/WebhookLogService";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/Utils/API";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * HOW EVERY WEBHOOK WENT, FOR THE PLATFORM'S OPERATOR (issue #6600).
 *
 * A webhook goes to the person's or the project's own endpoint, so it is
 * recorded as the project's (notification.provider.config). An endpoint
 * that answers an error is a failure even though the send does not throw -
 * its answer is logged, not raised - and one that cannot be reached is a
 * failure that throws.
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

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "66008888-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "66008888-0000-4000-8000-000000000002",
);

let post: jest.SpiedFunction<typeof API.post>;

function send(
  url: string = "https://hooks.example.com/oneuptime",
): Promise<void> {
  return WebhookService.sendWebhook(
    {
      url: url,
      eventType: "on-call.incident.created",
      payload: { incident: "Checkout API is down" },
    },
    { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
  );
}

function onlySend(): Record<string, string> {
  expect(sendCounterCalls).toHaveLength(1);
  expect(sendDurationCalls).toHaveLength(1);
  return sendCounterCalls[0]!.attributes;
}

beforeEach(() => {
  sendCounterCalls.length = 0;
  sendDurationCalls.length = 0;

  jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined as never);
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { ok: true }, {}) as never,
    );
  jest.spyOn(WebhookLogService, "create").mockResolvedValue({} as never);
  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a webhook", () => {
  test("its endpoint answered 2xx: a success, through the project's own endpoint", async () => {
    await send();

    expect(onlySend()).toEqual({
      "notification.channel": "webhook",
      "notification.provider": "webhook",
      "notification.provider.config": "project",
      "notification.on_call_page": "true",
      outcome: "success",
    });
  });

  test("its endpoint answered an error: a failure, though the send does not throw", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "boom" }, {}) as never,
    );

    await expect(send()).resolves.toBeUndefined();

    expect(onlySend()["outcome"]).toBe("failure");
  });

  test("its endpoint answered something that is not 2xx: a failure", async () => {
    post.mockResolvedValue(new HTTPResponse<JSONObject>(302, {}, {}) as never);

    await send();

    expect(onlySend()["outcome"]).toBe("failure");
  });

  test("its endpoint could not be reached: a failure that throws", async () => {
    post.mockRejectedValue(new Error("connect ECONNREFUSED") as never);

    await expect(send()).rejects.toThrow("ECONNREFUSED");

    expect(onlySend()["outcome"]).toBe("failure");
  });

  test("its URL was refused: a failure that throws", async () => {
    (
      SSRFProtection.validateWebhookTargetIsSafe as unknown as jest.Mock
    ).mockRejectedValue(new Error("Private network target") as never);

    await expect(send()).rejects.toThrow("Private network target");

    expect(post).not.toHaveBeenCalled();
    expect(onlySend()["outcome"]).toBe("failure");
  });
});
