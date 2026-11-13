import Project from "Common/Models/DatabaseModels/Project";
import TelegramLog from "Common/Models/DatabaseModels/TelegramLog";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import TelegramLogService from "Common/Server/Services/TelegramLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import OnCallTimelineRows, {
  StoredOnCallNotification,
} from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import { STUCK_NOTIFICATION_STATUS_MESSAGE } from "Common/Server/Utils/OnCall/OnCallNotificationStatus";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import API from "Common/Utils/API";
import ObjectID from "Common/Types/ObjectID";
import TelegramMessage from "Common/Types/Telegram/TelegramMessage";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import TelegramService from "../../FeatureSet/Notification/Services/TelegramService";

/*
 * HOW EVERY TELEGRAM MESSAGE WENT, FOR THE PLATFORM'S OPERATOR (issue #6600).
 *
 * Each message is recorded once (notification.send.count and .duration)
 * as handed to Telegram's Bot API: accepted, refused, or deliberately not
 * sent - the project turned Telegram off, has too little balance, or is
 * gone - which a delivery success rate leaves out.
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

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    TelegramTextDefaultCostInCents: 1,
    getTelegramConfig: jest
      .fn<() => Promise<{ botToken: string; botUsername: string }>>()
      .mockResolvedValue({
        botToken: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
        botUsername: "oneuptime_bot",
      }),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const URLType: { fromString: (url: string) => unknown } = (
    jest.requireActual("Common/Types/API/URL") as {
      default: { fromString: (url: string) => unknown };
    }
  ).default;

  return {
    IsBillingEnabled: true,
    DashboardClientUrl: URLType.fromString(
      "https://oneuptime.example.com/dashboard",
    ),
  };
});

jest.mock("Common/Server/Services/NotificationService", () => {
  return {
    __esModule: true,
    default: { rechargeIfBalanceIsLow: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      sendEmailToProjectOwners: jest.fn(),
      updateOneById: jest.fn(),
      claimSmsOrCallLowBalanceNotice: jest.fn(),
      deductSmsOrCallBalanceInUSDCents: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TelegramLogService", () => {
  return {
    __esModule: true,
    default: { create: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateOneBy: jest.fn(),
      markNotSent: jest.fn(),
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
  "66006666-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "66006666-0000-4000-8000-000000000002",
);

function project(overrides: Partial<Project> = {}): Project {
  const value: Project = new Project();
  value.id = PROJECT_ID;
  value.smsOrCallCurrentBalanceInUSDCents = 10_000;
  value.enableTelegramNotifications = true;
  value.lowCallAndSMSBalanceNotificationSentToOwners = true;
  value.notEnabledSmsOrCallNotificationSentToOwners = true;
  value.name = "Example project";
  Object.assign(value, overrides);
  return value;
}

function message(): TelegramMessage {
  return { to: "123456789", body: "Incident #12: Checkout API is down" };
}

function onlySend(): Record<string, string> {
  expect(sendCounterCalls).toHaveLength(1);
  expect(sendDurationCalls).toHaveLength(1);
  expect(sendDurationCalls[0]!.attributes).toEqual(
    sendCounterCalls[0]!.attributes,
  );
  return sendCounterCalls[0]!.attributes;
}

// The page's on-call log row (OnCallTimelineRows).
let timeline: OnCallTimelineRows;

describe("a Telegram message", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendCounterCalls.length = 0;
    sendDurationCalls.length = 0;

    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project() as never);
    jest
      .spyOn(NotificationService, "rechargeIfBalanceIsLow")
      .mockResolvedValue(10_000);
    jest
      .spyOn(TelegramLogService, "create")
      .mockResolvedValue(new TelegramLog() as never);
    jest.spyOn(API, "post").mockResolvedValue({
      jsonData: { ok: true, result: { message_id: 42 } },
    } as never);

    // The page's on-call log row, written over Sending only.
    timeline = new OnCallTimelineRows();
    timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
    timeline.standIn(UserOnCallLogTimelineService);
  });

  test("accepted by the Bot API: a success through telegram_bot_api", async () => {
    await TelegramService.sendTelegram(message(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(onlySend()).toEqual({
      "notification.channel": "telegram",
      "notification.provider": "telegram_bot_api",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      outcome: "success",
    });
  });

  test("refused by the Bot API: a failure, and the send still throws", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(
          403,
          { description: "Forbidden: bot was blocked by the user" },
          {},
        ) as never,
      );

    await expect(
      TelegramService.sendTelegram(message(), { projectId: PROJECT_ID }),
    ).rejects.toThrow("bot was blocked");

    expect(onlySend()).toMatchObject({
      "notification.provider": "telegram_bot_api",
      "notification.on_call_page": "false",
      outcome: "failure",
    });
  });

  test("answered not ok: a failure", async () => {
    jest.spyOn(API, "post").mockResolvedValue({
      jsonData: { ok: false, description: "Bad Request: chat not found" },
    } as never);

    await expect(
      TelegramService.sendTelegram(message(), { projectId: PROJECT_ID }),
    ).rejects.toThrow("chat not found");

    expect(onlySend()["outcome"]).toBe("failure");
  });

  test("the project turned Telegram off: not sent", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(
        project({ enableTelegramNotifications: false }) as never,
      );

    await TelegramService.sendTelegram(message(), { projectId: PROJECT_ID });

    expect(API.post).not.toHaveBeenCalled();
    expect(onlySend()["outcome"]).toBe("not_sent");
  });

  test("the project's balance cannot pay for it: not sent", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(
        project({ smsOrCallCurrentBalanceInUSDCents: 0 }) as never,
      );
    jest
      .spyOn(NotificationService, "rechargeIfBalanceIsLow")
      .mockResolvedValue(0);

    await TelegramService.sendTelegram(message(), { projectId: PROJECT_ID });

    expect(API.post).not.toHaveBeenCalled();
    expect(onlySend()["outcome"]).toBe("not_sent");
  });

  test("the project cannot be found: not sent", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null as never);

    await TelegramService.sendTelegram(message(), { projectId: PROJECT_ID });

    expect(onlySend()["outcome"]).toBe("not_sent");
  });

  test("with no chat to send to: a failure", async () => {
    await expect(
      TelegramService.sendTelegram(
        { to: "", body: "Hello" } as unknown as TelegramMessage,
        { projectId: PROJECT_ID },
      ),
    ).rejects.toThrow();

    expect(onlySend()["outcome"]).toBe("failure");
  });
  /*
   * THE PAGE'S ON-CALL TIMELINE ENTRY (issue #7082). The send's result is
   * written over Sending only - or over the stuck check's verdict, the
   * result come late - at the version it read (recordSendResult): the person
   * may have acknowledged or escalated the page meanwhile, from another of
   * its messages, and their answer stays.
   */
  describe("its on-call timeline entry", () => {
    // What the person answered the page with, from another of its messages.
    const ANSWERS: Array<{ status: UserNotificationStatus; message: string }> =
      [
        {
          status: UserNotificationStatus.Acknowledged,
          message: "Notification Acknowledged",
        },
        {
          status: UserNotificationStatus.PassedOn,
          message: "Escalated from this notification.",
        },
      ];

    interface TelegramOutcome {
      name: string;
      // The Bot API answers so, and the message is sent.
      send: () => Promise<void>;
      status: UserNotificationStatus;
      statusMessage: string;
    }

    const OUTCOMES: Array<TelegramOutcome> = [
      {
        name: "accepted by the Bot API",
        send: async (): Promise<void> => {
          await TelegramService.sendTelegram(message(), {
            projectId: PROJECT_ID,
            userOnCallLogTimelineId: TIMELINE_ID,
          });
        },
        status: UserNotificationStatus.Sent,
        statusMessage: "Message ID: 42",
      },
      {
        name: "refused by the Bot API",
        send: async (): Promise<void> => {
          jest
            .spyOn(API, "post")
            .mockResolvedValue(
              new HTTPErrorResponse(
                403,
                { description: "Forbidden: bot was blocked by the user" },
                {},
              ) as never,
            );

          await expect(
            TelegramService.sendTelegram(message(), {
              projectId: PROJECT_ID,
              userOnCallLogTimelineId: TIMELINE_ID,
            }),
          ).rejects.toThrow("bot was blocked");
        },
        status: UserNotificationStatus.Error,
        statusMessage: "Forbidden: bot was blocked by the user",
      },
    ];

    test.each(OUTCOMES)(
      "a Telegram message $name, while its entry still says Sending: the entry says so",
      async (outcome: TelegramOutcome) => {
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
          return OUTCOMES.map((outcome: TelegramOutcome) => {
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
      "a page already $answer, then a Telegram message $outcomeName: the answer stays",
      async (row: {
        answer: UserNotificationStatus;
        answerMessage: string;
        outcome: TelegramOutcome;
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
      "a Telegram message $name after the stuck check settled its entry: its own result, come late, replaces the verdict",
      async (outcome: TelegramOutcome) => {
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
      "a Telegram message $name, acknowledged between the send's read of its entry and its write: the acknowledgement stays",
      async (outcome: TelegramOutcome) => {
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
});
