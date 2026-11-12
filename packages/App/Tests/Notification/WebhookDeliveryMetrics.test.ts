import WebhookService from "../../FeatureSet/Notification/Services/WebhookService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import WebhookLogService from "Common/Server/Services/WebhookLogService";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import OnCallTimelineRows, {
  StoredOnCallNotification,
} from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import { STUCK_NOTIFICATION_STATUS_MESSAGE } from "Common/Server/Utils/OnCall/OnCallNotificationStatus";
import API from "Common/Utils/API";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

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

let post: SpyInstance<typeof API.post>;

// The page's on-call log row (OnCallTimelineRows).
let timeline: OnCallTimelineRows;

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
  // API.post is generic, so its spy is typed by a cast.
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { ok: true }, {}) as never,
    ) as unknown as SpyInstance<typeof API.post>;
  jest.spyOn(WebhookLogService, "create").mockResolvedValue({} as never);
  // The page's on-call log row, written over Sending only.
  timeline = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
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

/*
 * THE PAGE'S ON-CALL TIMELINE ENTRY (issue #7082). The send's result is
 * written over Sending only - or over the stuck check's verdict, the
 * result come late - at the version it read (recordSendResult): the person
 * may have acknowledged or escalated the page meanwhile, from another of
 * its messages, and their answer stays.
 */
describe("a webhook's on-call timeline entry", () => {
  // What the person answered the page with, from another of its messages.
  const ANSWERS: Array<{ status: UserNotificationStatus; message: string }> = [
    {
      status: UserNotificationStatus.Acknowledged,
      message: "Notification Acknowledged",
    },
    {
      status: UserNotificationStatus.PassedOn,
      message: "Escalated from this notification.",
    },
  ];

  interface WebhookOutcome {
    name: string;
    // The endpoint answers so, and the webhook is sent.
    send: () => Promise<void>;
    status: UserNotificationStatus;
    statusMessage: string;
  }

  const OUTCOMES: Array<WebhookOutcome> = [
    {
      name: "delivered",
      send: async (): Promise<void> => {
        await send();
      },
      status: UserNotificationStatus.Sent,
      statusMessage: "Webhook delivered successfully (HTTP 200).",
    },
    {
      name: "answered with an error",
      send: async (): Promise<void> => {
        post.mockResolvedValue(
          new HTTPErrorResponse(500, { message: "boom" }, {}) as never,
        );
        await send();
      },
      status: UserNotificationStatus.Error,
      statusMessage: "Webhook endpoint returned status 500.",
    },
    {
      name: "not reached",
      send: async (): Promise<void> => {
        post.mockRejectedValue(new Error("connect ECONNREFUSED") as never);
        await expect(send()).rejects.toThrow("ECONNREFUSED");
      },
      status: UserNotificationStatus.Error,
      statusMessage: "connect ECONNREFUSED",
    },
  ];

  test.each(OUTCOMES)(
    "a webhook $name, while its entry still says Sending: the entry says so",
    async (outcome: WebhookOutcome) => {
      await outcome.send();

      expect(timeline.get(TIMELINE_ID)).toMatchObject({
        status: outcome.status,
        statusMessage: outcome.statusMessage,
        version: 2,
      });
      expect(timeline.writes).toEqual([
        {
          id: TIMELINE_ID.toString(),
          data: {
            status: outcome.status,
            statusMessage: outcome.statusMessage,
          },
        },
      ]);
    },
  );

  test.each(
    ANSWERS.flatMap(
      (answer: { status: UserNotificationStatus; message: string }) => {
        return OUTCOMES.map((outcome: WebhookOutcome) => {
          return {
            answer: answer.status,
            answerMessage: answer.message,
            outcomeName: outcome.name,
            outcome: outcome,
          };
        });
      },
    ),
  )(
    "a page already $answer, then a webhook $outcomeName: the answer stays",
    async (row: {
      answer: UserNotificationStatus;
      answerMessage: string;
      outcome: WebhookOutcome;
    }) => {
      timeline.add(TIMELINE_ID, row.answer, {
        statusMessage: row.answerMessage,
      });

      await row.outcome.send();

      expect(timeline.get(TIMELINE_ID)).toMatchObject({
        status: row.answer,
        statusMessage: row.answerMessage,
        version: 1,
      });
      expect(timeline.writes).toEqual([]);
    },
  );

  test.each(OUTCOMES)(
    "a webhook $name after the stuck check settled its entry: its own result, come late, replaces the verdict",
    async (outcome: WebhookOutcome) => {
      timeline.add(TIMELINE_ID, UserNotificationStatus.Error, {
        statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
      });

      await outcome.send();

      expect(timeline.get(TIMELINE_ID)).toMatchObject({
        status: outcome.status,
        statusMessage: outcome.statusMessage,
        version: 2,
      });
    },
  );

  test.each(OUTCOMES)(
    "a webhook $name, acknowledged between the send's read of its entry and its write: the acknowledgement stays",
    async (outcome: WebhookOutcome) => {
      timeline.whenRead((row: StoredOnCallNotification) => {
        row.status = UserNotificationStatus.Acknowledged;
        row.statusMessage = "Notification Acknowledged";
      });

      await outcome.send();

      expect(timeline.get(TIMELINE_ID)).toMatchObject({
        status: UserNotificationStatus.Acknowledged,
        statusMessage: "Notification Acknowledged",
      });
      expect(timeline.writes).toEqual([]);
    },
  );
});
