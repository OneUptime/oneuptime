import TelegramBotUpdates from "../../../Server/Utils/TelegramBotUpdates";
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
  VerificationCodeRateLimitOutcome,
} from "../../../Server/Middleware/VerificationCodeRateLimit";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserTelegramService, {
  TelegramVerificationOutcome,
} from "../../../Server/Services/UserTelegramService";
import logger from "../../../Server/Utils/Logger";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../Utils/API";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";

/*
 * The bot's handling of one message, wherever it came from: Telegram's
 * webhook (App/FeatureSet/Notification/API/Telegram, whose tests hold the
 * webhook's own checks) or OneUptime polling Telegram (TelegramUpdatePolling).
 * A polled message has no HTTP request behind it, so nothing here may depend
 * on one, and the bot's token is read only when the bot replies.
 */

jest.mock("../../../Server/Services/UserTelegramService", () => {
  return {
    __esModule: true,
    default: {
      claimVerificationCode: jest.fn(),
      hasActiveProjectMembership: jest.fn(),
    },
    TelegramVerificationOutcome: {
      Verified: "verified",
      Invalid: "invalid",
      Expired: "expired",
      AlreadyClaimed: "already-claimed",
    },
  };
});

jest.mock("../../../Server/Services/UserNotificationRuleService", () => {
  return {
    __esModule: true,
    default: { addDefaultNotificationRulesForVerifiedMethod: jest.fn() },
  };
});

jest.mock("../../../Server/Middleware/VerificationCodeRateLimit", () => {
  return {
    __esModule: true,
    default: { consume: jest.fn() },
    VerificationCodeRateLimitBucket: { Verify: "verify" },
    VerificationCodeRateLimitOutcome: {
      Allowed: "allowed",
      RateLimited: "rate-limited",
      CounterUnavailable: "counter-unavailable",
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { error: jest.fn(), warn: jest.fn() },
  };
});

jest.mock("../../../Utils/API", () => {
  return {
    __esModule: true,
    default: { post: jest.fn() },
  };
});

const BOT_TOKEN: string = "8012345678:ABCdefGHIjklMNOpqrsTUVwxyz-0987654321";
const ITEM_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const userTelegramService: {
  claimVerificationCode: jest.Mock;
  hasActiveProjectMembership: jest.Mock;
} = UserTelegramService as unknown as {
  claimVerificationCode: jest.Mock;
  hasActiveProjectMembership: jest.Mock;
};
const notificationRuleService: {
  addDefaultNotificationRulesForVerifiedMethod: jest.Mock;
} = UserNotificationRuleService as unknown as {
  addDefaultNotificationRulesForVerifiedMethod: jest.Mock;
};
const rateLimit: { consume: jest.Mock } =
  VerificationCodeRateLimit as unknown as { consume: jest.Mock };
const api: { post: jest.Mock } = API as unknown as { post: jest.Mock };
const log: { error: jest.Mock } = logger as unknown as { error: jest.Mock };

const getBotToken: Mock<() => Promise<string>> = jest.fn<
  () => Promise<string>
>();

function update(text: string | undefined, chatId: number = 4242): JSONObject {
  return {
    update_id: 1,
    message: {
      text: text,
      chat: { id: chatId },
      date: 1_800_000_000,
    },
  } as JSONObject;
}

async function handle(data: JSONObject): Promise<void> {
  await TelegramBotUpdates.handleUpdate({
    update: data,
    getBotToken: getBotToken,
  });
}

// The text of each reply the bot sent, in order.
function replies(): Array<string> {
  return api.post.mock.calls.map((call: Array<unknown>): string => {
    return String((call[0] as { data: JSONObject }).data["text"]);
  });
}

function verifiedItem(): UserTelegram {
  const item: UserTelegram = new UserTelegram();
  item.id = ITEM_ID;
  item.userId = USER_ID;
  item.projectId = PROJECT_ID;
  return item;
}

describe("TelegramBotUpdates.handleUpdate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getBotToken.mockResolvedValue(BOT_TOKEN);
    rateLimit.consume.mockResolvedValue({
      outcome: VerificationCodeRateLimitOutcome.Allowed,
    });
    userTelegramService.claimVerificationCode.mockResolvedValue({
      outcome: TelegramVerificationOutcome.Invalid,
    });
    userTelegramService.hasActiveProjectMembership.mockResolvedValue(true);
    notificationRuleService.addDefaultNotificationRulesForVerifiedMethod.mockResolvedValue(
      undefined,
    );
    api.post.mockResolvedValue({});
  });

  test.each([
    ["an update that is not a message", { update_id: 1, edited_message: {} }],
    ["a message without text", update(undefined)],
    ["an ordinary message", update("hello bot")],
  ])(
    "ignores %s without reading the token",
    async (_name: string, data: JSONObject) => {
      await handle(data);

      expect(rateLimit.consume).not.toHaveBeenCalled();
      expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
      expect(getBotToken).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    },
  );

  test("limits /start attempts by the Telegram chat, which a polled message has without any HTTP request", async () => {
    await handle(update("/start some-code", 987654321));

    expect(rateLimit.consume).toHaveBeenCalledWith({
      itemKey: "telegram-start",
      userKey: "telegram-chat:987654321",
      clientIp: "telegram-chat:987654321",
      bucket: VerificationCodeRateLimitBucket.Verify,
    });
  });

  test("links the account, adds the default rules and says so, replying with the bot's token", async () => {
    userTelegramService.claimVerificationCode.mockResolvedValue({
      outcome: TelegramVerificationOutcome.Verified,
      item: verifiedItem(),
    });

    await handle(update("/start the-code", 5150));

    expect(userTelegramService.claimVerificationCode).toHaveBeenCalledWith({
      verificationCode: "the-code",
      telegramChatId: "5150",
    });
    expect(
      notificationRuleService.addDefaultNotificationRulesForVerifiedMethod,
    ).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
      notificationMethod: { userTelegramId: ITEM_ID },
    });
    expect(replies()).toEqual([expect.stringContaining("Verified!")]);

    const request: { url: { toString: () => string }; data: JSONObject } = api
      .post.mock.calls[0]![0] as {
      url: { toString: () => string };
      data: JSONObject;
    };
    expect(request.url.toString()).toBe(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    );
    expect(request.data["chat_id"]).toBe("5150");
  });

  test("answers a code that does not verify the same way, whatever the reason", async () => {
    await handle(update("/start wrong-code"));

    expect(replies()).toEqual([
      expect.stringContaining("invalid, expired, or has already been used"),
    ]);
    expect(
      notificationRuleService.addDefaultNotificationRulesForVerifiedMethod,
    ).not.toHaveBeenCalled();
  });

  test("explains how to send the code when /start comes without one", async () => {
    await handle(update("/start"));

    expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
    expect(replies()).toEqual([
      expect.stringContaining("Please include your verification code"),
    ]);
  });

  test("throws when the verification cannot be read, so the message is delivered again", async () => {
    userTelegramService.claimVerificationCode.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(handle(update("/start the-code"))).rejects.toThrow(
      "database unavailable",
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  test("logs a reply it cannot send instead of failing the message", async () => {
    getBotToken.mockRejectedValue(
      new Error("Telegram bot token not configured"),
    );

    await expect(handle(update("/start"))).resolves.toBeUndefined();
    expect(api.post).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });
});
