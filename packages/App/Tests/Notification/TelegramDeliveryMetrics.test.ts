import Project from "Common/Models/DatabaseModels/Project";
import TelegramLog from "Common/Models/DatabaseModels/TelegramLog";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import TelegramLogService from "Common/Server/Services/TelegramLogService";
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
    default: { updateOneById: jest.fn(), markNotSent: jest.fn() },
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
});
