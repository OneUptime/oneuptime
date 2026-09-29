import { mockRouter } from "Common/Tests/Server/API/Helpers";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
  VerificationCodeRateLimitOutcome,
} from "Common/Server/Middleware/VerificationCodeRateLimit";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserTelegramService, {
  TelegramVerificationOutcome,
} from "Common/Server/Services/UserTelegramService";
import TelegramVerificationToken from "Common/Server/Utils/TelegramVerificationToken";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import API from "Common/Utils/API";
import UserTelegram from "Common/Models/DatabaseModels/UserTelegram";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import TelegramService from "../../FeatureSet/Notification/Services/TelegramService";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      warn: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: { isAuthorizedServiceMiddleware: jest.fn() },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: { getTelegramWebhookSecretToken: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserTelegramService", () => {
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

jest.mock("Common/Server/Services/UserNotificationRuleService", () => {
  return {
    __esModule: true,
    default: { addDefaultNotificationRulesForVerifiedMethod: jest.fn() },
  };
});

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: { post: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    __esModule: true,
    getTelegramConfig: jest
      .fn<
        () => Promise<{
          botToken: string;
          botUsername: string;
        }>
      >()
      .mockResolvedValue({
        botToken: "bot-token",
        botUsername: "oneuptime_bot",
      }),
  };
});

jest.mock("../../FeatureSet/Notification/Services/TelegramService", () => {
  return {
    __esModule: true,
    default: { sendTelegram: jest.fn() },
  };
});

import "../../FeatureSet/Notification/API/Telegram";

const globalConfigService: { getTelegramWebhookSecretToken: jest.Mock } =
  GlobalConfigService as unknown as {
    getTelegramWebhookSecretToken: jest.Mock;
  };
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
const responseUtil: { sendEmptySuccessResponse: jest.Mock } =
  Response as unknown as {
    sendEmptySuccessResponse: jest.Mock;
  };
const api: { post: jest.Mock } = API as unknown as { post: jest.Mock };
const telegramService: { sendTelegram: jest.Mock } =
  TelegramService as unknown as { sendTelegram: jest.Mock };

const ITEM_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const WEBHOOK_SECRET: string = "oneuptime_telegram_secret_01234567";

function verifiedItem(chatId: string): UserTelegram {
  const item: UserTelegram = new UserTelegram();
  item.id = ITEM_ID;
  item.userId = USER_ID;
  item.projectId = PROJECT_ID;
  item.isVerified = true;
  item.telegramChatId = chatId;
  return item;
}

async function callWebhook(data: {
  configuredSecret?: string | undefined;
  providedSecret?: string | string[] | undefined;
  text?: string | undefined;
  chatId?: string | undefined;
}): Promise<{
  response: ExpressResponse;
  next: NextFunction;
}> {
  globalConfigService.getTelegramWebhookSecretToken.mockResolvedValue(
    data.configuredSecret,
  );

  const response: ExpressResponse = {
    sendStatus: jest.fn(),
  } as unknown as ExpressResponse;
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const request: ExpressRequest = {
    headers: {
      "x-telegram-bot-api-secret-token": data.providedSecret,
    },
    body: {
      message: {
        text: data.text,
        chat: { id: data.chatId || "chat-a" },
      },
    },
  } as unknown as ExpressRequest;

  await mockRouter
    .match("post", "/webhook")
    .handlerFunction(request, response, next);

  return { response, next };
}

describe("Telegram webhook security", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(VerificationCodeRateLimit, "consume").mockResolvedValue({
      outcome: VerificationCodeRateLimitOutcome.Allowed,
    });
    globalConfigService.getTelegramWebhookSecretToken.mockResolvedValue(
      WEBHOOK_SECRET,
    );
    userTelegramService.claimVerificationCode.mockResolvedValue({
      outcome: TelegramVerificationOutcome.Invalid,
    });
    userTelegramService.hasActiveProjectMembership.mockResolvedValue(true);
    notificationRuleService.addDefaultNotificationRulesForVerifiedMethod.mockResolvedValue(
      undefined,
    );
    api.post.mockResolvedValue({});
  });

  test("allows only a master administrator to invoke the global bot test route", () => {
    expect(mockRouter.match("post", "/test").middlewares).toEqual([
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    ]);
  });

  test("never lets the bot test route bill a caller-selected project", async () => {
    const request: ExpressRequest = {
      body: {
        toChatId: "chat-a",
        projectId: PROJECT_ID.toString(),
      },
    } as unknown as ExpressRequest;
    const response: ExpressResponse = {} as ExpressResponse;
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await mockRouter
      .match("post", "/test")
      .handlerFunction(request, response, next);

    expect(telegramService.sendTelegram).toHaveBeenCalledWith(
      expect.objectContaining({ to: "chat-a" }),
      { isSensitive: false },
    );
    expect(
      (telegramService.sendTelegram as jest.Mock).mock.calls[0]![1],
    ).not.toHaveProperty("projectId");
    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalledWith(
      request,
      response,
    );
  });

  test("fails closed when no webhook secret is configured", async () => {
    const { response } = await callWebhook({
      configuredSecret: undefined,
      providedSecret: "anything",
      text: "/start anything",
    });

    expect(response.sendStatus).toHaveBeenCalledWith(503);
    expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
    expect(VerificationCodeRateLimit.consume).not.toHaveBeenCalled();
  });

  test("fails closed when a legacy weak webhook secret is configured", async () => {
    const { response } = await callWebhook({
      configuredSecret: "short-secret",
      providedSecret: "short-secret",
      text: "/start anything",
    });

    expect(response.sendStatus).toHaveBeenCalledWith(503);
    expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
    expect(VerificationCodeRateLimit.consume).not.toHaveBeenCalled();
  });

  test.each([
    undefined,
    "",
    "wrong-secret",
    `${WEBHOOK_SECRET} `,
    ["wrong-secret", WEBHOOK_SECRET],
  ])(
    "rejects a missing or mismatched webhook header %#",
    async (provided: string | string[] | undefined) => {
      const { response } = await callWebhook({
        configuredSecret: WEBHOOK_SECRET,
        providedSecret: provided,
        text: "/start anything",
      });

      expect(response.sendStatus).toHaveBeenCalledWith(403);
      expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
    },
  );

  test("accepts administrator whitespace only around the configured secret", async () => {
    await callWebhook({
      configuredSecret: `  ${WEBHOOK_SECRET}  `,
      providedSecret: WEBHOOK_SECRET,
      text: "ordinary message",
    });

    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalled();
  });

  test("rate limits invalid webhook-secret guesses before any verification lookup", async () => {
    await callWebhook({
      configuredSecret: WEBHOOK_SECRET,
      providedSecret: "wrong-secret",
      text: `/start ${TelegramVerificationToken.mint()}`,
    });

    expect(VerificationCodeRateLimit.consume).toHaveBeenCalledWith({
      itemKey: "telegram-webhook-invalid-secret",
      userKey: "telegram-webhook:unknown",
      clientIp: "unknown",
      bucket: VerificationCodeRateLimitBucket.Verify,
    });
    expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
  });

  test("uses one bounded rate-limit item key for many distinct invalid webhook secrets", async () => {
    const consumeMock: jest.Mock =
      VerificationCodeRateLimit.consume as unknown as jest.Mock;
    const distinctSecrets: Array<string> = Array.from(
      { length: 50 },
      (_value: unknown, index: number): string => {
        return `wrong-secret-${index}`;
      },
    );

    for (const providedSecret of distinctSecrets) {
      await callWebhook({
        configuredSecret: WEBHOOK_SECRET,
        providedSecret,
        text: `/start ${TelegramVerificationToken.mint()}`,
      });
    }

    const itemKeys: Array<string> = consumeMock.mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as { itemKey: string }).itemKey;
      },
    );

    expect(itemKeys).toHaveLength(distinctSecrets.length);
    expect(new Set(itemKeys)).toEqual(
      new Set<string>(["telegram-webhook-invalid-secret"]),
    );
    expect(JSON.stringify(consumeMock.mock.calls)).not.toContain(
      "wrong-secret-49",
    );
    expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
  });

  test("does not amplify a rate-limit store outage with one warning per bad secret", async () => {
    jest.spyOn(VerificationCodeRateLimit, "consume").mockResolvedValue({
      outcome: VerificationCodeRateLimitOutcome.CounterUnavailable,
    });

    const { response } = await callWebhook({
      configuredSecret: WEBHOOK_SECRET,
      providedSecret: "wrong-secret",
      text: `/start ${TelegramVerificationToken.mint()}`,
    });

    expect(response.sendStatus).toHaveBeenCalledWith(403);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
  });

  test("ignores authenticated non-start messages without touching verification", async () => {
    await callWebhook({
      configuredSecret: WEBHOOK_SECRET,
      providedSecret: WEBHOOK_SECRET,
      text: "hello bot",
    });

    expect(VerificationCodeRateLimit.consume).not.toHaveBeenCalled();
    expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalled();
  });

  test("rate limits a bare start command before sending usage help", async () => {
    await callWebhook({
      configuredSecret: WEBHOOK_SECRET,
      providedSecret: WEBHOOK_SECRET,
      text: "/start",
      chatId: "bare-start-chat",
    });

    expect(VerificationCodeRateLimit.consume).toHaveBeenCalledWith({
      itemKey: "telegram-start",
      userKey: "telegram-chat:bare-start-chat",
      clientIp: "telegram-chat:bare-start-chat",
      bucket: VerificationCodeRateLimitBucket.Verify,
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
  });

  test("silently drops repeated bare start commands after rate limiting", async () => {
    jest.spyOn(VerificationCodeRateLimit, "consume").mockResolvedValue({
      outcome: VerificationCodeRateLimitOutcome.RateLimited,
      retryAfterSeconds: 60,
      isFirstRejectionInWindow: false,
    });

    await callWebhook({
      configuredSecret: WEBHOOK_SECRET,
      providedSecret: WEBHOOK_SECRET,
      text: "/start",
      chatId: "bare-start-chat",
    });

    expect(api.post).not.toHaveBeenCalled();
    expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalled();
  });

  test("fails closed without a bot reply when the start limiter is unavailable", async () => {
    jest.spyOn(VerificationCodeRateLimit, "consume").mockResolvedValue({
      outcome: VerificationCodeRateLimitOutcome.CounterUnavailable,
    });

    await callWebhook({
      configuredSecret: WEBHOOK_SECRET,
      providedSecret: WEBHOOK_SECRET,
      text: `/start ${TelegramVerificationToken.mint()}`,
      chatId: "redis-outage-chat",
    });

    expect(api.post).not.toHaveBeenCalled();
    expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalled();
  });

  test("rate limits start attempts by a bounded item key and Telegram chat", async () => {
    const token: string = TelegramVerificationToken.mint();

    await callWebhook({
      configuredSecret: WEBHOOK_SECRET,
      providedSecret: WEBHOOK_SECRET,
      text: `/start ${token}`,
      chatId: "987654321",
    });

    expect(VerificationCodeRateLimit.consume).toHaveBeenCalledWith({
      itemKey: "telegram-start",
      userKey: "telegram-chat:987654321",
      clientIp: "telegram-chat:987654321",
      bucket: VerificationCodeRateLimitBucket.Verify,
    });
    expect(
      JSON.stringify(
        (VerificationCodeRateLimit.consume as unknown as jest.Mock).mock.calls,
      ),
    ).not.toContain(token);
  });

  test("uses one bounded rate-limit item key for many distinct start tokens", async () => {
    const consumeMock: jest.Mock =
      VerificationCodeRateLimit.consume as unknown as jest.Mock;
    const tokens: Array<string> = Array.from({ length: 50 }, (): string => {
      return TelegramVerificationToken.mint();
    });

    for (const token of tokens) {
      await callWebhook({
        configuredSecret: WEBHOOK_SECRET,
        providedSecret: WEBHOOK_SECRET,
        text: `/start ${token}`,
        chatId: "bounded-cardinality-chat",
      });
    }

    const itemKeys: Array<string> = consumeMock.mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as { itemKey: string }).itemKey;
      },
    );

    expect(itemKeys).toHaveLength(tokens.length);
    expect(new Set(itemKeys)).toEqual(new Set<string>(["telegram-start"]));
    for (const token of tokens) {
      expect(JSON.stringify(consumeMock.mock.calls)).not.toContain(token);
    }
  });

  test("silently drops repeated attempts after the rate-limit budget is exhausted", async () => {
    jest.spyOn(VerificationCodeRateLimit, "consume").mockResolvedValue({
      outcome: VerificationCodeRateLimitOutcome.RateLimited,
      retryAfterSeconds: 60,
      isFirstRejectionInWindow: false,
    });

    await callWebhook({
      configuredSecret: WEBHOOK_SECRET,
      providedSecret: WEBHOOK_SECRET,
      text: `/start ${TelegramVerificationToken.mint()}`,
    });

    expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalled();
  });

  test("sends at most one rate-limit notice per window", async () => {
    jest.spyOn(VerificationCodeRateLimit, "consume").mockResolvedValue({
      outcome: VerificationCodeRateLimitOutcome.RateLimited,
      retryAfterSeconds: 60,
      isFirstRejectionInWindow: true,
    });

    await callWebhook({
      configuredSecret: WEBHOOK_SECRET,
      providedSecret: WEBHOOK_SECRET,
      text: `/start ${TelegramVerificationToken.mint()}`,
    });

    expect(userTelegramService.claimVerificationCode).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalled();
  });

  test.each([
    TelegramVerificationOutcome.Invalid,
    TelegramVerificationOutcome.Expired,
    TelegramVerificationOutcome.AlreadyClaimed,
  ])(
    "gives the same non-oracular response for %s",
    async (outcome: TelegramVerificationOutcome) => {
      userTelegramService.claimVerificationCode.mockResolvedValue({ outcome });
      const token: string = TelegramVerificationToken.mint();

      await callWebhook({
        configuredSecret: WEBHOOK_SECRET,
        providedSecret: WEBHOOK_SECRET,
        text: `/start ${token}`,
      });

      expect(userTelegramService.claimVerificationCode).toHaveBeenCalledWith({
        verificationCode: token,
        telegramChatId: "chat-a",
      });
      const replyBody: string = JSON.stringify(api.post.mock.calls[0]);
      expect(replyBody).toContain("invalid, expired, or has already been used");
      expect(
        notificationRuleService.addDefaultNotificationRulesForVerifiedMethod,
      ).not.toHaveBeenCalled();
    },
  );

  test("creates default rules only after the atomic claim reports this chat as winner", async () => {
    const token: string = TelegramVerificationToken.mint();
    userTelegramService.claimVerificationCode.mockResolvedValue({
      outcome: TelegramVerificationOutcome.Verified,
      item: verifiedItem("chat-winner"),
    });

    await callWebhook({
      configuredSecret: WEBHOOK_SECRET,
      providedSecret: WEBHOOK_SECRET,
      text: `/start ${token}`,
      chatId: "chat-winner",
    });

    expect(
      notificationRuleService.addDefaultNotificationRulesForVerifiedMethod,
    ).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
      notificationMethod: { userTelegramId: ITEM_ID },
    });
    const replyBody: string = JSON.stringify(api.post.mock.calls[0]);
    expect(replyBody).toContain("Verified!");
  });

  test("does not create rules when membership is removed after the atomic claim", async () => {
    const token: string = TelegramVerificationToken.mint();
    userTelegramService.claimVerificationCode.mockResolvedValue({
      outcome: TelegramVerificationOutcome.Verified,
      item: verifiedItem("former-member-chat"),
    });
    userTelegramService.hasActiveProjectMembership.mockResolvedValue(false);

    await callWebhook({
      configuredSecret: WEBHOOK_SECRET,
      providedSecret: WEBHOOK_SECRET,
      text: `/start ${token}`,
      chatId: "former-member-chat",
    });

    expect(userTelegramService.hasActiveProjectMembership).toHaveBeenCalledWith(
      {
        projectId: PROJECT_ID,
        userId: USER_ID,
      },
    );
    expect(
      notificationRuleService.addDefaultNotificationRulesForVerifiedMethod,
    ).not.toHaveBeenCalled();
    expect(JSON.stringify(api.post.mock.calls[0])).toContain(
      "invalid, expired, or has already been used",
    );
  });

  test("passes backend errors to Express without marking a method verified", async () => {
    const failure: Error = new Error("database unavailable");
    userTelegramService.claimVerificationCode.mockRejectedValue(failure);

    const { next } = await callWebhook({
      configuredSecret: WEBHOOK_SECRET,
      providedSecret: WEBHOOK_SECRET,
      text: `/start ${TelegramVerificationToken.mint()}`,
    });

    expect(next).toHaveBeenCalledWith(failure);
    expect(
      notificationRuleService.addDefaultNotificationRulesForVerifiedMethod,
    ).not.toHaveBeenCalled();
  });
});
