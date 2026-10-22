import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
  VerificationCodeRateLimitDecision,
  VerificationCodeRateLimitOutcome,
} from "../Middleware/VerificationCodeRateLimit";
import UserNotificationRuleService from "../Services/UserNotificationRuleService";
import UserTelegramService, {
  TelegramVerificationOutcome,
  TelegramVerificationResult,
} from "../Services/UserTelegramService";
import logger from "./Logger";
import UserTelegram from "../../Models/DatabaseModels/UserTelegram";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import API from "../../Utils/API";

/*
 * What the OneUptime bot does with a message someone sends it: the
 * `/start <code>` that links their Telegram account to a notification method,
 * and nothing else. A message reaches OneUptime one of two ways
 * (GlobalConfig.telegramPollForUpdates): Telegram posts it to the webhook
 * (App/FeatureSet/Notification/API/Telegram), or OneUptime fetches it from
 * Telegram (TelegramUpdatePolling). Both hand it here, so linking an account
 * works the same either way.
 */

// The bot's token, read only when the bot has something to reply.
export type GetTelegramBotToken = () => Promise<string>;

/*
 * This value deliberately has bounded cardinality. VerificationCodeRateLimit
 * creates an item counter before it decides whether the shared user/IP counter
 * is over budget. Deriving this segment from the command would therefore let
 * a sender allocate one Redis key per distinct guess.
 *
 * The limiter includes userKey in the item-counter key, so this constant is
 * still independently scoped per Telegram chat.
 */
const TELEGRAM_START_RATE_LIMIT_ITEM_KEY: string = "telegram-start";

export default class TelegramBotUpdates {
  /*
   * Handles one Telegram update. Anything but a `/start` message is ignored.
   * A failure to read or write the verification throws, so the caller can
   * have the update delivered again: the webhook answers with an error, and
   * polling leaves it unconfirmed.
   */
  public static async handleUpdate(data: {
    update: JSONObject;
    getBotToken: GetTelegramBotToken;
  }): Promise<void> {
    const telegramMessage: JSONObject | undefined =
      (data.update["message"] as JSONObject | undefined) || undefined;

    if (!telegramMessage) {
      return;
    }

    const text: string | undefined =
      (telegramMessage["text"] as string | undefined) || undefined;
    const chat: JSONObject | undefined =
      (telegramMessage["chat"] as JSONObject | undefined) || undefined;

    if (!text || !chat || chat["id"] === undefined) {
      return;
    }

    const chatId: string = String(chat["id"]);

    if (!text.startsWith("/start")) {
      return;
    }

    const parts: Array<string> = text.trim().split(/\s+/);
    const code: string | undefined = parts[1];

    const rateLimitDecision: VerificationCodeRateLimitDecision =
      await VerificationCodeRateLimit.consume({
        itemKey: TELEGRAM_START_RATE_LIMIT_ITEM_KEY,
        userKey: `telegram-chat:${chatId}`,
        /*
         * Telegram forwards every update from its own infrastructure, so the
         * HTTP source address is shared by every user - and a polled update
         * has none. The stable chat id is the meaningful client identity.
         */
        clientIp: `telegram-chat:${chatId}`,
        bucket: VerificationCodeRateLimitBucket.Verify,
      });

    if (
      rateLimitDecision.outcome !== VerificationCodeRateLimitOutcome.Allowed
    ) {
      if (
        rateLimitDecision.outcome ===
          VerificationCodeRateLimitOutcome.RateLimited &&
        rateLimitDecision.isFirstRejectionInWindow
      ) {
        await this.sendBotReply({
          getBotToken: data.getBotToken,
          chatId,
          text: "❌ Too many verification attempts. Please wait and open OneUptime to request a new link.",
        });
      }
      return;
    }

    if (!code) {
      await this.sendBotReply({
        getBotToken: data.getBotToken,
        chatId,
        text: "ℹ️ Please include your verification code like this:\n\n/start <code>\n\nOpen OneUptime → User Settings → Notification Methods → Telegram to grab your link.",
      });
      return;
    }

    const verificationResult: TelegramVerificationResult =
      await UserTelegramService.claimVerificationCode({
        verificationCode: code,
        telegramChatId: chatId,
      });

    if (
      verificationResult.outcome !== TelegramVerificationOutcome.Verified ||
      !verificationResult.item
    ) {
      await this.sendBotReply({
        getBotToken: data.getBotToken,
        chatId,
        text: "❌ That verification link is invalid, expired, or has already been used. Please open OneUptime and request a new one.",
      });
      return;
    }

    const match: UserTelegram = verificationResult.item;

    if (
      !match.projectId ||
      !match.userId ||
      !(await UserTelegramService.hasActiveProjectMembership({
        projectId: match.projectId,
        userId: match.userId,
      }))
    ) {
      await this.sendBotReply({
        getBotToken: data.getBotToken,
        chatId,
        text: "❌ That verification link is invalid, expired, or has already been used. Please open OneUptime and request a new one.",
      });
      return;
    }

    try {
      await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
        {
          projectId: new ObjectID(match.projectId!.toString()),
          userId: new ObjectID(match.userId!.toString()),
          notificationMethod: {
            userTelegramId: new ObjectID(match.id!.toString()),
          },
        },
      );
    } catch (e) {
      logger.error(e);
    }

    await this.sendBotReply({
      getBotToken: data.getBotToken,
      chatId,
      text: "🎉 Verified! You'll now receive OneUptime alerts here.\n\n🔔 Head back to OneUptime to pick which events you want delivered.",
    });
  }

  // A reply from the bot. A reply that cannot be sent is logged, never thrown.
  public static async sendBotReply(data: {
    getBotToken: GetTelegramBotToken;
    chatId: string;
    text: string;
  }): Promise<void> {
    try {
      const botToken: string = await data.getBotToken();

      const url: URL = new URL(
        Protocol.HTTPS,
        "api.telegram.org",
        new Route(`/bot${botToken}/sendMessage`),
      );

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url,
          data: {
            chat_id: data.chatId,
            text: data.text,
          },
          headers: {
            "Content-Type": "application/json",
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error("Failed to send Telegram bot reply.");
        logger.error(response);
      }
    } catch (err) {
      logger.error(err);
    }
  }
}
