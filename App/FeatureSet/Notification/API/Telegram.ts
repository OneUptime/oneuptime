import { getTelegramConfig, TelegramConfig } from "../Config";
import TelegramService from "../Services/TelegramService";
import BadDataException from "Common/Types/Exception/BadDataException";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import UserTelegram from "Common/Models/DatabaseModels/UserTelegram";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TelegramMessage from "Common/Types/Telegram/TelegramMessage";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import UserTelegramService from "Common/Server/Services/UserTelegramService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
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
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      if (!body["toChatId"]) {
        throw new BadDataException("toChatId is required");
      }

      const message: TelegramMessage = {
        to: String(body["toChatId"]),
        body: "This is a test Telegram notification from OneUptime.",
        disableWebPagePreview: true,
      };

      await TelegramService.sendTelegram(message, {
        projectId: body["projectId"]
          ? new ObjectID(body["projectId"] as string)
          : undefined,
        isSensitive: false,
      });

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
      const globalConfig: GlobalConfig | null =
        await GlobalConfigService.findOneBy({
          query: {
            _id: ObjectID.getZeroObjectID().toString(),
          },
          props: {
            isRoot: true,
          },
          select: {
            telegramWebhookSecretToken: true,
          },
        });

      const configuredSecret: string | undefined =
        globalConfig?.telegramWebhookSecretToken?.trim() || undefined;

      if (configuredSecret) {
        const providedSecret: string | undefined =
          (req.headers["x-telegram-bot-api-secret-token"] as
            | string
            | undefined) || undefined;

        if (providedSecret !== configuredSecret) {
          logger.warn(
            "Rejected Telegram webhook — secret token mismatch.",
            getLogAttributesFromRequest(req as any),
          );
          res.sendStatus(403);
          return;
        }
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

      if (!code) {
        await sendBotReply(
          chatId,
          "Please provide a verification code: /start <code>. Open OneUptime → User Settings → Notification Methods → Telegram to grab your link.",
        );
        return Response.sendEmptySuccessResponse(req, res);
      }

      const match: UserTelegram | null = await UserTelegramService.findOneBy({
        query: {
          verificationCode: code,
        },
        select: {
          _id: true,
          userId: true,
          projectId: true,
          isVerified: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!match) {
        await sendBotReply(
          chatId,
          "That verification code is invalid or expired. Please open OneUptime and request a new one.",
        );
        return Response.sendEmptySuccessResponse(req, res);
      }

      if (match.isVerified) {
        await sendBotReply(
          chatId,
          "This Telegram account is already linked to OneUptime.",
        );
        return Response.sendEmptySuccessResponse(req, res);
      }

      await UserTelegramService.updateOneById({
        id: match.id!,
        data: {
          isVerified: true,
          telegramChatId: chatId,
        },
        props: {
          isRoot: true,
        },
      });

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
        "Verified — you'll now receive OneUptime alerts here.",
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
