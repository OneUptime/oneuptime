import { getTelegramConfig, TelegramConfig } from "../Config";
import TelegramService from "../Services/TelegramService";
import BadDataException from "Common/Types/Exception/BadDataException";
import UserTelegram from "Common/Models/DatabaseModels/UserTelegram";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TelegramMessage from "Common/Types/Telegram/TelegramMessage";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
  VerificationCodeRateLimitDecision,
  VerificationCodeRateLimitOutcome,
} from "Common/Server/Middleware/VerificationCodeRateLimit";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import UserTelegramService, {
  TelegramVerificationOutcome,
  TelegramVerificationResult,
} from "Common/Server/Services/UserTelegramService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import TelegramVerificationToken from "Common/Server/Utils/TelegramVerificationToken";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";

const router: ExpressRouter = Express.getRouter();
const WEBHOOK_CONFIG_LOG_INTERVAL_MS: number = 60 * 1000;
/*
 * These values deliberately have bounded cardinality. VerificationCodeRateLimit
 * creates an item counter before it decides whether the shared user/IP counter
 * is over budget. Deriving this segment from an untrusted header or command
 * would therefore let a caller allocate one Redis key per distinct guess.
 *
 * The limiter includes userKey in the item-counter key, so these constants are
 * still independently scoped per trusted client IP and Telegram chat.
 */
const INVALID_WEBHOOK_SECRET_RATE_LIMIT_ITEM_KEY: string =
  "telegram-webhook-invalid-secret";
const TELEGRAM_START_RATE_LIMIT_ITEM_KEY: string = "telegram-start";
let lastWebhookConfigErrorLoggedAt: number = 0;

function shouldLogWebhookConfigError(): boolean {
  const now: number = Date.now();

  if (now - lastWebhookConfigErrorLoggedAt < WEBHOOK_CONFIG_LOG_INTERVAL_MS) {
    return false;
  }

  lastWebhookConfigErrorLoggedAt = now;
  return true;
}

router.post(
  "/send",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      if (!body["to"]) {
        throw new BadDataException("`to` chat id is required");
      }

      if (!body["body"]) {
        throw new BadDataException("`body` is required");
      }

      const message: TelegramMessage = {
        to: String(body["to"]),
        body: String(body["body"]),
        parseMode: body["parseMode"] as "MarkdownV2" | "HTML" | undefined,
        disableWebPagePreview: body["disableWebPagePreview"] as
          | boolean
          | undefined,
      };

      await TelegramService.sendTelegram(message, {
        projectId: body["projectId"]
          ? new ObjectID(body["projectId"] as string)
          : undefined,
        isSensitive: Boolean(body["isSensitive"]),
        userOnCallLogTimelineId: body["userOnCallLogTimelineId"]
          ? new ObjectID(body["userOnCallLogTimelineId"] as string)
          : undefined,
        incidentId: body["incidentId"]
          ? new ObjectID(body["incidentId"] as string)
          : undefined,
        alertId: body["alertId"]
          ? new ObjectID(body["alertId"] as string)
          : undefined,
        monitorId: body["monitorId"]
          ? new ObjectID(body["monitorId"] as string)
          : undefined,
        scheduledMaintenanceId: body["scheduledMaintenanceId"]
          ? new ObjectID(body["scheduledMaintenanceId"] as string)
          : undefined,
        statusPageId: body["statusPageId"]
          ? new ObjectID(body["statusPageId"] as string)
          : undefined,
        statusPageAnnouncementId: body["statusPageAnnouncementId"]
          ? new ObjectID(body["statusPageAnnouncementId"] as string)
          : undefined,
        userId: body["userId"]
          ? new ObjectID(body["userId"] as string)
          : undefined,
        onCallPolicyId: body["onCallPolicyId"]
          ? new ObjectID(body["onCallPolicyId"] as string)
          : undefined,
        onCallPolicyEscalationRuleId: body["onCallPolicyEscalationRuleId"]
          ? new ObjectID(body["onCallPolicyEscalationRuleId"] as string)
          : undefined,
        onCallDutyPolicyExecutionLogTimelineId: body[
          "onCallDutyPolicyExecutionLogTimelineId"
        ]
          ? new ObjectID(
              body["onCallDutyPolicyExecutionLogTimelineId"] as string,
            )
          : undefined,
        onCallScheduleId: body["onCallScheduleId"]
          ? new ObjectID(body["onCallScheduleId"] as string)
          : undefined,
        teamId: body["teamId"]
          ? new ObjectID(body["teamId"] as string)
          : undefined,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/test",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      if (!body["toChatId"]) {
        throw new BadDataException("toChatId is required");
      }

      const message: TelegramMessage = {
        to: String(body["toChatId"]),
        body: [
          "🧪 <b>Test notification from OneUptime</b>",
          "",
          "✅ Your Telegram bot is wired up and can reach this chat.",
          "",
          "You'll receive alerts and on-call pages here once a OneUptime user has Telegram enabled in their notification rules.",
        ].join("\n"),
        parseMode: "HTML",
        disableWebPagePreview: true,
      };

      /*
       * This tests the instance-wide bot configuration. It must never charge,
       * recharge, or write a notification log against a caller-selected
       * tenant, even for a master administrator.
       */
      await TelegramService.sendTelegram(message, { isSensitive: false });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/webhook",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const configuredSecret: string | undefined =
        await GlobalConfigService.getTelegramWebhookSecretToken();

      /*
       * A missing configured secret must disable the public webhook, not
       * silently turn authentication off. Telegram is configured with this
       * same value via setWebhook; requests without an exact constant-time
       * match never reach parsing, rate limiting, or the database.
       */
      if (
        !configuredSecret ||
        !TelegramVerificationToken.isWebhookSecretStrong(configuredSecret)
      ) {
        if (shouldLogWebhookConfigError()) {
          logger.error(
            "Rejected Telegram webhook — no strong webhook secret is configured.",
            getLogAttributesFromRequest(req as any),
          );
        }
        res.sendStatus(503);
        return;
      }

      const providedHeader: string | string[] | undefined = req.headers[
        "x-telegram-bot-api-secret-token"
      ] as string | string[] | undefined;
      const providedSecret: string | undefined = Array.isArray(providedHeader)
        ? providedHeader[0]
        : providedHeader;

      if (
        !TelegramVerificationToken.isWebhookSecretValid({
          configuredSecret,
          providedSecret,
        })
      ) {
        const clientIp: string = VerificationCodeRateLimit.resolveClientIp(req);
        const invalidSecretDecision: VerificationCodeRateLimitDecision =
          await VerificationCodeRateLimit.consume({
            itemKey: INVALID_WEBHOOK_SECRET_RATE_LIMIT_ITEM_KEY,
            userKey: `telegram-webhook:${clientIp}`,
            clientIp,
            bucket: VerificationCodeRateLimitBucket.Verify,
          });

        if (
          invalidSecretDecision.outcome ===
            VerificationCodeRateLimitOutcome.Allowed ||
          (invalidSecretDecision.outcome ===
            VerificationCodeRateLimitOutcome.RateLimited &&
            invalidSecretDecision.isFirstRejectionInWindow)
        ) {
          logger.warn(
            "Rejected Telegram webhook — secret token mismatch.",
            getLogAttributesFromRequest(req as any),
          );
        }
        res.sendStatus(403);
        return;
      }

      const update: JSONObject = req.body as JSONObject;
      const telegramMessage: JSONObject | undefined =
        (update["message"] as JSONObject | undefined) || undefined;

      if (!telegramMessage) {
        return Response.sendEmptySuccessResponse(req, res);
      }

      const text: string | undefined =
        (telegramMessage["text"] as string | undefined) || undefined;
      const chat: JSONObject | undefined =
        (telegramMessage["chat"] as JSONObject | undefined) || undefined;

      if (!text || !chat || chat["id"] === undefined) {
        return Response.sendEmptySuccessResponse(req, res);
      }

      const chatId: string = String(chat["id"]);

      if (!text.startsWith("/start")) {
        return Response.sendEmptySuccessResponse(req, res);
      }

      const parts: Array<string> = text.trim().split(/\s+/);
      const code: string | undefined = parts[1];

      const rateLimitDecision: VerificationCodeRateLimitDecision =
        await VerificationCodeRateLimit.consume({
          itemKey: TELEGRAM_START_RATE_LIMIT_ITEM_KEY,
          userKey: `telegram-chat:${chatId}`,
          /*
           * Telegram forwards every update from its own infrastructure, so the
           * HTTP source address is shared by every user. The stable chat id is
           * the meaningful client identity for this webhook.
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
          await sendBotReply(
            chatId,
            "❌ Too many verification attempts. Please wait and open OneUptime to request a new link.",
          );
        }
        return Response.sendEmptySuccessResponse(req, res);
      }

      if (!code) {
        await sendBotReply(
          chatId,
          "ℹ️ Please include your verification code like this:\n\n/start <code>\n\nOpen OneUptime → User Settings → Notification Methods → Telegram to grab your link.",
        );
        return Response.sendEmptySuccessResponse(req, res);
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
        await sendBotReply(
          chatId,
          "❌ That verification link is invalid, expired, or has already been used. Please open OneUptime and request a new one.",
        );
        return Response.sendEmptySuccessResponse(req, res);
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
        await sendBotReply(
          chatId,
          "❌ That verification link is invalid, expired, or has already been used. Please open OneUptime and request a new one.",
        );
        return Response.sendEmptySuccessResponse(req, res);
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

      await sendBotReply(
        chatId,
        "🎉 Verified! You'll now receive OneUptime alerts here.\n\n🔔 Head back to OneUptime to pick which events you want delivered.",
      );

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

async function sendBotReply(chatId: string, text: string): Promise<void> {
  try {
    const config: TelegramConfig = await getTelegramConfig();

    const url: URL = new URL(
      Protocol.HTTPS,
      "api.telegram.org",
      new Route(`/bot${config.botToken}/sendMessage`),
    );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url,
        data: {
          chat_id: chatId,
          text,
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

export default router;
