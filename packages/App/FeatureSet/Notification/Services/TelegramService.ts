import {
  TelegramTextDefaultCostInCents,
  getTelegramConfig,
  TelegramConfig,
} from "../Config";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import TelegramMessage from "Common/Types/Telegram/TelegramMessage";
import TelegramStatus from "Common/Types/TelegramStatus";
import { JSONObject } from "Common/Types/JSON";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import TelegramLogService from "Common/Server/Services/TelegramLogService";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import { redactLogString } from "Common/Server/Utils/LogRedaction";
import Project from "Common/Models/DatabaseModels/Project";
import TelegramLog from "Common/Models/DatabaseModels/TelegramLog";
import API from "Common/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";

const SENSITIVE_MESSAGE_PLACEHOLDER: string =
  "This message is sensitive and is not logged";

export default class TelegramService {
  public static async sendTelegram(
    message: TelegramMessage,
    options: {
      projectId?: ObjectID | undefined;
      isSensitive?: boolean | undefined;
      userOnCallLogTimelineId?: ObjectID | undefined;
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
      monitorId?: ObjectID | undefined;
      scheduledMaintenanceId?: ObjectID | undefined;
      statusPageId?: ObjectID | undefined;
      statusPageAnnouncementId?: ObjectID | undefined;
      userId?: ObjectID | undefined;
      onCallPolicyId?: ObjectID | undefined;
      onCallPolicyEscalationRuleId?: ObjectID | undefined;
      onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
      teamId?: ObjectID | undefined;
    } = {},
  ): Promise<void> {
    let sendError: Error | null = null;
    const telegramLog: TelegramLog = new TelegramLog();

    try {
      if (!message.to) {
        throw new BadDataException("Telegram chat id is required");
      }

      if (!message.body) {
        throw new BadDataException("Telegram message body is required");
      }

      const isSensitiveMessage: boolean = Boolean(options.isSensitive);
      const messageSummary: string = isSensitiveMessage
        ? SENSITIVE_MESSAGE_PLACEHOLDER
        : message.body;

      telegramLog.toChatId = message.to;
      telegramLog.messageText = messageSummary;
      telegramLog.telegramCostInUSDCents = 0;

      if (options.projectId) {
        telegramLog.projectId = options.projectId;
      }

      if (options.incidentId) {
        telegramLog.incidentId = options.incidentId;
      }

      if (options.alertId) {
        telegramLog.alertId = options.alertId;
      }

      if (options.monitorId) {
        telegramLog.monitorId = options.monitorId;
      }

      if (options.scheduledMaintenanceId) {
        telegramLog.scheduledMaintenanceId = options.scheduledMaintenanceId;
      }

      if (options.statusPageId) {
        telegramLog.statusPageId = options.statusPageId;
      }

      if (options.statusPageAnnouncementId) {
        telegramLog.statusPageAnnouncementId = options.statusPageAnnouncementId;
      }

      if (options.userId) {
        telegramLog.userId = options.userId;
      }

      if (options.teamId) {
        telegramLog.teamId = options.teamId;
      }

      if (options.onCallPolicyId) {
        telegramLog.onCallDutyPolicyId = options.onCallPolicyId;
      }

      if (options.onCallPolicyEscalationRuleId) {
        telegramLog.onCallDutyPolicyEscalationRuleId =
          options.onCallPolicyEscalationRuleId;
      }

      if (options.onCallScheduleId) {
        telegramLog.onCallDutyPolicyScheduleId = options.onCallScheduleId;
      }

      let messageCost: number = 0;
      const shouldChargeForMessage: boolean = IsBillingEnabled;

      if (shouldChargeForMessage) {
        messageCost = TelegramTextDefaultCostInCents / 100;
      }

      let project: Project | null = null;

      if (options.projectId) {
        project = await ProjectService.findOneById({
          id: options.projectId,
          select: {
            smsOrCallCurrentBalanceInUSDCents: true,
            enableTelegramNotifications: true,
            lowCallAndSMSBalanceNotificationSentToOwners: true,
            name: true,
            notEnabledSmsOrCallNotificationSentToOwners: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (!project) {
          telegramLog.status = TelegramStatus.Error;
          telegramLog.statusMessage = `Project ${options.projectId.toString()} not found.`;
          logger.error(telegramLog.statusMessage);
          await TelegramLogService.create({
            data: telegramLog,
            props: {
              isRoot: true,
            },
          });
          return;
        }

        if (!project.enableTelegramNotifications) {
          telegramLog.status = TelegramStatus.Error;
          telegramLog.statusMessage =
            "Telegram notifications are not enabled for this project. Please enable Telegram notifications in Project Settings.";

          // The project owner disabled this channel; refusal is expected.
          logger.error(telegramLog.statusMessage, EXTERNAL_FAULT);
          await TelegramLogService.create({
            data: telegramLog,
            props: {
              isRoot: true,
            },
          });

          if (!project.notEnabledSmsOrCallNotificationSentToOwners) {
            await ProjectService.updateOneById({
              id: project.id!,
              data: {
                notEnabledSmsOrCallNotificationSentToOwners: true,
              },
              props: {
                isRoot: true,
              },
            });

            /*
             * Deliberately omit the destination chat and message body. Alert
             * payloads can contain incident secrets, and owner-notification
             * email is a different delivery channel with different readers.
             */
            await ProjectService.sendEmailToProjectOwners(
              project.id!,
              `Telegram notifications not enabled for ${project.name || ""}`,
              "A Telegram notification was not sent because Telegram notifications are disabled for this project. Please enable Telegram notifications in Project Settings if this channel should be used.",
            );
          }

          return;
        }

        if (shouldChargeForMessage && messageCost > 0) {
          let updatedBalance: number =
            project.smsOrCallCurrentBalanceInUSDCents || 0;

          try {
            updatedBalance = await NotificationService.rechargeIfBalanceIsLow(
              project.id!,
            );
          } catch (err) {
            logger.error(err);
          }

          project.smsOrCallCurrentBalanceInUSDCents = updatedBalance;

          if (
            !project.smsOrCallCurrentBalanceInUSDCents ||
            project.smsOrCallCurrentBalanceInUSDCents < messageCost * 100
          ) {
            telegramLog.status = TelegramStatus.LowBalance;
            telegramLog.statusMessage = `Project does not have enough balance to send Telegram message. Current balance is ${
              (project.smsOrCallCurrentBalanceInUSDCents || 0) / 100
            } USD. Required balance is ${messageCost} USD.`;
            logger.error(telegramLog.statusMessage);

            await TelegramLogService.create({
              data: telegramLog,
              props: {
                isRoot: true,
              },
            });

            if (!project.lowCallAndSMSBalanceNotificationSentToOwners) {
              await ProjectService.updateOneById({
                id: project.id!,
                data: {
                  lowCallAndSMSBalanceNotificationSentToOwners: true,
                },
                props: {
                  isRoot: true,
                },
              });

              await ProjectService.sendEmailToProjectOwners(
                project.id!,
                `Low Telegram message balance for ${project.name || ""}`,
                `We tried to send a Telegram message to chat ${message.to} with message:<br/><br/>${messageSummary}<br/><br/>The message was not sent because your project does not have enough balance for Telegram messages. Current balance is ${
                  (project.smsOrCallCurrentBalanceInUSDCents || 0) / 100
                } USD. Required balance is ${messageCost} USD. Please enable auto recharge or recharge manually.`,
              );
            }
            return;
          }
        }
      }

      const config: TelegramConfig = await getTelegramConfig();

      if (config.botUsername) {
        telegramLog.fromBotUsername = config.botUsername;
      }

      const payload: JSONObject = {
        chat_id: message.to,
        text: message.body,
      };

      if (message.parseMode) {
        payload["parse_mode"] = message.parseMode;
      }

      if (message.disableWebPagePreview !== undefined) {
        payload["disable_web_page_preview"] = message.disableWebPagePreview;
      }

      const url: URL = new URL(
        Protocol.HTTPS,
        "api.telegram.org",
        new Route(`/bot${config.botToken}/sendMessage`),
      );

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url,
          data: payload,
          headers: {
            "Content-Type": "application/json",
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error("Failed to send Telegram message.");
        logger.error(response);
        const description: string | undefined =
          (response.data?.["description"] as string | undefined) ||
          (
            response.jsonData as
              | { description?: string | undefined }
              | undefined
          )?.description;

        throw new BadDataException(
          description || "Failed to send Telegram message.",
        );
      }

      const responseData: JSONObject = (response.jsonData || {}) as JSONObject;

      if (responseData["ok"] === false) {
        const description: string =
          (responseData["description"] as string) || "Telegram API Error.";
        throw new BadDataException(description);
      }

      const result: JSONObject | undefined =
        (responseData["result"] as JSONObject | undefined) || undefined;
      const telegramMessageId: string | undefined =
        result && result["message_id"] !== undefined
          ? String(result["message_id"])
          : undefined;

      if (telegramMessageId) {
        telegramLog.telegramMessageId = telegramMessageId;
      }

      telegramLog.status = TelegramStatus.Sent;
      telegramLog.statusMessage = telegramMessageId
        ? `Message ID: ${telegramMessageId}`
        : "Telegram message sent successfully";

      if (shouldChargeForMessage && project && messageCost > 0) {
        const deduction: number = Math.floor(messageCost * 100);
        telegramLog.telegramCostInUSDCents = deduction;

        project.smsOrCallCurrentBalanceInUSDCents = Math.max(
          0,
          Math.floor(
            (project.smsOrCallCurrentBalanceInUSDCents || 0) - deduction,
          ),
        );

        await ProjectService.updateOneById({
          id: project.id!,
          data: {
            smsOrCallCurrentBalanceInUSDCents:
              project.smsOrCallCurrentBalanceInUSDCents,
            notEnabledSmsOrCallNotificationSentToOwners: false,
          },
          props: {
            isRoot: true,
          },
        });
      }
    } catch (error: unknown) {
      logger.error("Failed to send Telegram message.");
      logger.error(error);
      telegramLog.telegramCostInUSDCents = 0;
      telegramLog.status = TelegramStatus.Error;
      const errorMessage: string =
        error instanceof Error && error.message
          ? error.message
          : `${error as string}`;
      const safeErrorMessage: string = redactLogString(errorMessage);
      telegramLog.statusMessage = safeErrorMessage;

      sendError =
        error instanceof Error && safeErrorMessage === error.message
          ? error
          : new Error(safeErrorMessage);
    }

    if (options.projectId) {
      await TelegramLogService.create({
        data: telegramLog,
        props: {
          isRoot: true,
        },
      });
    }

    if (options.userOnCallLogTimelineId) {
      await UserOnCallLogTimelineService.updateOneById({
        id: options.userOnCallLogTimelineId,
        data: {
          status: [
            TelegramStatus.Success,
            TelegramStatus.Sent,
            TelegramStatus.Delivered,
            TelegramStatus.Read,
          ].includes(telegramLog.status || TelegramStatus.Error)
            ? UserNotificationStatus.Sent
            : UserNotificationStatus.Error,
          statusMessage: telegramLog.statusMessage,
        },
        props: {
          isRoot: true,
        },
      });
    }

    if (sendError) {
      throw sendError;
    }
  }
}
