import Project from "Common/Models/DatabaseModels/Project";
import TelegramLog from "Common/Models/DatabaseModels/TelegramLog";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import TelegramLogService from "Common/Server/Services/TelegramLogService";
import API from "Common/Utils/API";
import ObjectID from "Common/Types/ObjectID";
import TelegramMessage from "Common/Types/Telegram/TelegramMessage";
import TelegramStatus from "Common/Types/TelegramStatus";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import TelegramService from "../../FeatureSet/Notification/Services/TelegramService";

const BOT_TOKEN: string = "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    TelegramTextDefaultCostInCents: 1,
    getTelegramConfig: jest
      .fn<
        () => Promise<{
          botToken: string;
          botUsername: string;
        }>
      >()
      .mockResolvedValue({
        botToken: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
        botUsername: "oneuptime_bot",
      }),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return { IsBillingEnabled: true };
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
    default: { updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CHAT_ID: string = "123456789";
const MESSAGE_BODY: string = "incident secret that must not enter owner email";

function project(overrides: Partial<Project> = {}): Project {
  const value: Project = new Project();
  value.id = PROJECT_ID;
  value.smsOrCallCurrentBalanceInUSDCents = 10_000;
  value.enableTelegramNotifications = true;
  value.lowCallAndSMSBalanceNotificationSentToOwners = false;
  value.notEnabledSmsOrCallNotificationSentToOwners = false;
  value.name = "Example project";
  Object.assign(value, overrides);
  return value;
}

function message(): TelegramMessage {
  return {
    to: CHAT_ID,
    body: MESSAGE_BODY,
  };
}

describe("TelegramService credential containment", () => {
  beforeEach(() => {
    jest.clearAllMocks();

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
      jsonData: {
        ok: true,
        result: { message_id: "telegram-message-id" },
      },
    } as never);
  });

  test("removes a bot token from the persisted failure and rethrown error", async () => {
    const failure: Error = new Error(
      `POST https://api.telegram.org/bot${BOT_TOKEN}/sendMessage failed with ECONNRESET`,
    );
    jest.spyOn(API, "post").mockRejectedValue(failure);

    let thrown: Error | undefined;

    try {
      await TelegramService.sendTelegram(message(), {
        projectId: PROJECT_ID,
        isSensitive: false,
      });
    } catch (error: unknown) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).not.toContain(BOT_TOKEN);
    expect(thrown?.message).toContain("[REDACTED]");

    expect(TelegramLogService.create).toHaveBeenCalledTimes(1);
    const persistedLog: TelegramLog = (
      TelegramLogService.create as unknown as jest.Mock
    ).mock.calls[0]![0].data as TelegramLog;

    expect(persistedLog.statusMessage).not.toContain(BOT_TOKEN);
    expect(persistedLog.statusMessage).toContain("[REDACTED]");
  });

  test("refuses a disabled project before recharge, provider send, or balance deduction", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      project({
        enableTelegramNotifications: false,
        notEnabledSmsOrCallNotificationSentToOwners: false,
      }) as never,
    );

    await TelegramService.sendTelegram(message(), {
      projectId: PROJECT_ID,
      isSensitive: false,
    });

    expect(ProjectService.findOneById).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: expect.objectContaining({ enableTelegramNotifications: true }),
      props: { isRoot: true },
    });
    expect(NotificationService.rechargeIfBalanceIsLow).not.toHaveBeenCalled();
    expect(API.post).not.toHaveBeenCalled();

    expect(ProjectService.updateOneById).toHaveBeenCalledTimes(1);
    expect(ProjectService.updateOneById).toHaveBeenCalledWith({
      id: PROJECT_ID,
      data: { notEnabledSmsOrCallNotificationSentToOwners: true },
      props: { isRoot: true },
    });
    expect(
      (ProjectService.updateOneById as unknown as jest.Mock).mock.calls.some(
        (call: Array<unknown>): boolean => {
          const data: Record<string, unknown> = (
            call[0] as { data: Record<string, unknown> }
          ).data;
          return "smsOrCallCurrentBalanceInUSDCents" in data;
        },
      ),
    ).toBe(false);

    expect(TelegramLogService.create).toHaveBeenCalledTimes(1);
    const persistedLog: TelegramLog = (
      TelegramLogService.create as unknown as jest.Mock
    ).mock.calls[0]![0].data as TelegramLog;
    expect(persistedLog.status).toBe(TelegramStatus.Error);
    expect(persistedLog.telegramCostInUSDCents).toBe(0);
    expect(persistedLog.statusMessage).toBe(
      "Telegram notifications are not enabled for this project. Please enable Telegram notifications in Project Settings.",
    );
  });

  test("owner notice for a disabled project contains neither destination nor message body", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(
        project({ enableTelegramNotifications: false }) as never,
      );

    await TelegramService.sendTelegram(message(), {
      projectId: PROJECT_ID,
      isSensitive: false,
    });

    expect(ProjectService.sendEmailToProjectOwners).toHaveBeenCalledTimes(1);
    const ownerEmailCall: Array<unknown> = (
      ProjectService.sendEmailToProjectOwners as unknown as jest.Mock
    ).mock.calls[0]!;
    const serializedOwnerEmail: string = JSON.stringify(ownerEmailCall);
    expect(serializedOwnerEmail).not.toContain(CHAT_ID);
    expect(serializedOwnerEmail).not.toContain(MESSAGE_BODY);
    expect(serializedOwnerEmail).toContain(
      "Telegram notifications are disabled",
    );
  });

  test("does not repeatedly notify owners when the disabled-channel notice was already sent", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      project({
        enableTelegramNotifications: false,
        notEnabledSmsOrCallNotificationSentToOwners: true,
      }) as never,
    );

    await TelegramService.sendTelegram(message(), { projectId: PROJECT_ID });

    expect(ProjectService.sendEmailToProjectOwners).not.toHaveBeenCalled();
    expect(ProjectService.updateOneById).not.toHaveBeenCalled();
    expect(NotificationService.rechargeIfBalanceIsLow).not.toHaveBeenCalled();
    expect(API.post).not.toHaveBeenCalled();
    expect(TelegramLogService.create).toHaveBeenCalledTimes(1);
  });

  test("an enabled project still recharges, sends, records, and deducts exactly once", async () => {
    await TelegramService.sendTelegram(message(), {
      projectId: PROJECT_ID,
      isSensitive: false,
    });

    expect(NotificationService.rechargeIfBalanceIsLow).toHaveBeenCalledTimes(1);
    expect(NotificationService.rechargeIfBalanceIsLow).toHaveBeenCalledWith(
      PROJECT_ID,
    );
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(API.post).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chat_id: CHAT_ID,
          text: MESSAGE_BODY,
        }),
      }),
    );
    expect(ProjectService.updateOneById).toHaveBeenCalledTimes(1);
    expect(ProjectService.updateOneById).toHaveBeenCalledWith({
      id: PROJECT_ID,
      data: {
        smsOrCallCurrentBalanceInUSDCents: 9_999,
        notEnabledSmsOrCallNotificationSentToOwners: false,
      },
      props: { isRoot: true },
    });
    expect(TelegramLogService.create).toHaveBeenCalledTimes(1);
    const persistedLog: TelegramLog = (
      TelegramLogService.create as unknown as jest.Mock
    ).mock.calls[0]![0].data as TelegramLog;
    expect(persistedLog.status).toBe(TelegramStatus.Sent);
    expect(persistedLog.telegramCostInUSDCents).toBe(1);
  });

  test("projectless internal messages retain provider-send semantics without billing or persistence", async () => {
    await TelegramService.sendTelegram(message(), { isSensitive: true });

    expect(ProjectService.findOneById).not.toHaveBeenCalled();
    expect(NotificationService.rechargeIfBalanceIsLow).not.toHaveBeenCalled();
    expect(ProjectService.updateOneById).not.toHaveBeenCalled();
    expect(ProjectService.sendEmailToProjectOwners).not.toHaveBeenCalled();
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(TelegramLogService.create).not.toHaveBeenCalled();
  });
});
