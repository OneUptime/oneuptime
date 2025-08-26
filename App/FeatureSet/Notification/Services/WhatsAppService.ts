import {
  WhatsAppTextDefaultCostInCents,
  WhatsAppTextHighRiskCostInCents,
  getMetaWhatsAppConfig,
} from "../Config";
import { isHighRiskPhoneNumber } from "Common/Types/Call/CallRequest";
import MetaWhatsAppConfig from "Common/Types/WhatsApp/MetaWhatsAppConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
import Text from "Common/Types/Text";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import WhatsAppLogService from "Common/Server/Services/WhatsAppLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";
import { JSONObject } from "Common/Types/JSON";

export default class WhatsAppService {
  public static async sendWhatsApp(
    to: Phone,
    message: string,
    options: {
      projectId?: ObjectID | undefined; // project id for whatsapp log
      customMetaWhatsAppConfig?: MetaWhatsAppConfig | undefined;
      isSensitive?: boolean; // if true, message will not be logged
      userOnCallLogTimelineId?: ObjectID | undefined;
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
      scheduledMaintenanceId?: ObjectID | undefined;
      statusPageId?: ObjectID | undefined;
      statusPageAnnouncementId?: ObjectID | undefined;
      userId?: ObjectID | undefined;
      // On-call policy related fields
      onCallPolicyId?: ObjectID | undefined;
      onCallPolicyEscalationRuleId?: ObjectID | undefined;
      onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
      teamId?: ObjectID | undefined;
    },
  ): Promise<void> {
    let whatsappError: Error | null = null;
    const whatsappLog: WhatsAppLog = new WhatsAppLog();

    try {
      // check number of messages to send for this entire message. Each WhatsApp message can have more characters than SMS
      const messageSegments: number = Math.ceil(message.length / 1000); // WhatsApp has higher character limit

      message = Text.trimLines(message);

      let whatsappCost: number = 0;

      const shouldChargeForWhatsApp: boolean =
        IsBillingEnabled && !options.customMetaWhatsAppConfig;

      if (shouldChargeForWhatsApp) {
        whatsappCost = WhatsAppTextDefaultCostInCents / 100;

        if (isHighRiskPhoneNumber(to)) {
          whatsappCost = WhatsAppTextHighRiskCostInCents / 100;
        }
      }

      if (messageSegments > 1) {
        whatsappCost = whatsappCost * messageSegments;
      }

      whatsappLog.toNumber = to;

      whatsappLog.whatsAppText =
        options && options.isSensitive
          ? "This message is sensitive and is not logged"
          : message;
      whatsappLog.whatsAppCostInUSDCents = 0;

      if (options.projectId) {
        whatsappLog.projectId = options.projectId;
      }

      if (options.incidentId) {
        whatsappLog.incidentId = options.incidentId;
      }

      if (options.alertId) {
        whatsappLog.alertId = options.alertId;
      }

      if (options.scheduledMaintenanceId) {
        whatsappLog.scheduledMaintenanceId = options.scheduledMaintenanceId;
      }

      if (options.statusPageId) {
        whatsappLog.statusPageId = options.statusPageId;
      }

      if (options.statusPageAnnouncementId) {
        whatsappLog.statusPageAnnouncementId = options.statusPageAnnouncementId;
      }

      if (options.userId) {
        whatsappLog.userId = options.userId;
      }

      if (options.teamId) {
        whatsappLog.teamId = options.teamId;
      }

      // Set OnCall-related fields
      if (options.onCallPolicyId) {
        whatsappLog.onCallDutyPolicyId = options.onCallPolicyId;
      }

      if (options.onCallPolicyEscalationRuleId) {
        whatsappLog.onCallDutyPolicyEscalationRuleId =
          options.onCallPolicyEscalationRuleId;
      }

      if (options.onCallScheduleId) {
        whatsappLog.onCallDutyPolicyScheduleId = options.onCallScheduleId;
      }

      const metaWhatsAppConfig: MetaWhatsAppConfig | null =
        options.customMetaWhatsAppConfig || (await getMetaWhatsAppConfig());

      if (!metaWhatsAppConfig) {
        throw new BadDataException("Meta WhatsApp Config not found");
      }

      // No fromNumber for Meta WhatsApp Business API as it uses Phone Number ID
      whatsappLog.fromNumber = new Phone(metaWhatsAppConfig.phoneNumberId);

      let project: Project | null = null;

      // make sure project has enough balance.

      if (options.projectId) {
        project = await ProjectService.findOneById({
          id: options.projectId,
          select: {
            smsOrCallCurrentBalanceInUSDCents: true,
            enableWhatsAppNotifications: true,
            lowCallAndSMSBalanceNotificationSentToOwners: true,
            name: true,
            notEnabledSmsOrCallNotificationSentToOwners: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (!project) {
          whatsappLog.status = WhatsAppStatus.Error;
          whatsappLog.statusMessage = `Project ${options.projectId.toString()} not found.`;
          logger.error(whatsappLog.statusMessage);
          await WhatsAppLogService.create({
            data: whatsappLog,
            props: {
              isRoot: true,
            },
          });
          return;
        }

        if (!project.enableWhatsAppNotifications) {
          whatsappLog.status = WhatsAppStatus.Error;
          whatsappLog.statusMessage = `WhatsApp notifications are not enabled for this project. Please enable WhatsApp notifications in Project Settings.`;
          logger.error(whatsappLog.statusMessage);
          await WhatsAppLogService.create({
            data: whatsappLog,
            props: {
              isRoot: true,
            },
          });
          if (!project.notEnabledSmsOrCallNotificationSentToOwners) {
            await ProjectService.updateOneById({
              data: {
                notEnabledSmsOrCallNotificationSentToOwners: true,
              },
              id: project.id!,
              props: {
                isRoot: true,
              },
            });
            await ProjectService.sendEmailToProjectOwners(
              project.id!,
              "WhatsApp notifications not enabled for " + (project.name || ""),
              `We tried to send a WhatsApp message to ${to.toString()} with message: <br/> <br/> ${message} <br/> <br/> This WhatsApp message was not sent because SMS notifications are not enabled for this project. Please enable SMS notifications in Project Settings.`,
            );
          }
          return;
        }

        if (shouldChargeForWhatsApp) {
          // check if auto recharge is enabled and current balance is low.
          let updatedBalance: number =
            project.smsOrCallCurrentBalanceInUSDCents!;
          try {
            updatedBalance = await NotificationService.rechargeIfBalanceIsLow(
              project.id!,
            );
          } catch (err) {
            logger.error(err);
          }

          project.smsOrCallCurrentBalanceInUSDCents = updatedBalance;

          if (!project.smsOrCallCurrentBalanceInUSDCents) {
            whatsappLog.status = WhatsAppStatus.LowBalance;
            whatsappLog.statusMessage = `Project ${options.projectId.toString()} does not have enough WhatsApp balance.`;
            logger.error(whatsappLog.statusMessage);
            await WhatsAppLogService.create({
              data: whatsappLog,
              props: {
                isRoot: true,
              },
            });

            if (!project.lowCallAndSMSBalanceNotificationSentToOwners) {
              await ProjectService.updateOneById({
                data: {
                  lowCallAndSMSBalanceNotificationSentToOwners: true,
                },
                id: project.id!,
                props: {
                  isRoot: true,
                },
              });
              await ProjectService.sendEmailToProjectOwners(
                project.id!,
                "Low SMS and Call Balance for " + (project.name || ""),
                `We tried to send a WhatsApp message to ${to.toString()} with message: <br/> <br/> ${message} <br/>This WhatsApp message was not sent because project does not have enough balance to send WhatsApp messages. Current balance is ${
                  (project.smsOrCallCurrentBalanceInUSDCents || 0) / 100
                } USD cents. Required balance to send this WhatsApp message is ${whatsappCost} USD. Please enable auto recharge or recharge manually.`,
              );
            }
            return;
          }

          if (project.smsOrCallCurrentBalanceInUSDCents < whatsappCost * 100) {
            whatsappLog.status = WhatsAppStatus.LowBalance;
            whatsappLog.statusMessage = `Project does not have enough balance to send WhatsApp message. Current balance is ${
              project.smsOrCallCurrentBalanceInUSDCents / 100
            } USD. Required balance is ${whatsappCost} USD to send this WhatsApp message.`;
            logger.error(whatsappLog.statusMessage);
            await WhatsAppLogService.create({
              data: whatsappLog,
              props: {
                isRoot: true,
              },
            });
            if (!project.lowCallAndSMSBalanceNotificationSentToOwners) {
              await ProjectService.updateOneById({
                data: {
                  lowCallAndSMSBalanceNotificationSentToOwners: true,
                },
                id: project.id!,
                props: {
                  isRoot: true,
                },
              });
              await ProjectService.sendEmailToProjectOwners(
                project.id!,
                "Low SMS and Call Balance for " + (project.name || ""),
                `We tried to send a WhatsApp message to ${to.toString()} with message: <br/> <br/> ${message} <br/> <br/> This WhatsApp message was not sent because project does not have enough balance to send WhatsApp messages. Current balance is ${
                  project.smsOrCallCurrentBalanceInUSDCents / 100
                } USD. Required balance is ${whatsappCost} USD to send this WhatsApp message. Please enable auto recharge or recharge manually.`,
              );
            }
            return;
          }
        }
      }

      // Send WhatsApp message using Meta WhatsApp Business API
      const metaApiUrl = `https://graph.facebook.com/v18.0/${metaWhatsAppConfig.phoneNumberId}/messages`;
      
      const messagePayload: JSONObject = {
        messaging_product: "whatsapp",
        to: to.toString(),
        type: "text",
        text: {
          body: message,
        },
      };

      // Use fetch directly since the Meta API doesn't fit the existing URL pattern
      const fetchResponse = await fetch(metaApiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${metaWhatsAppConfig.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messagePayload),
      });

      if (!fetchResponse.ok) {
        const errorText = await fetchResponse.text();
        throw new BadDataException(
          `Failed to send WhatsApp message: ${fetchResponse.status} - ${errorText}`,
        );
      }

      const responseData = await fetchResponse.json() as JSONObject;
      const messages = responseData["messages"] as any;
      const messageId = messages && Array.isArray(messages) && messages[0] ? messages[0]["id"] as string : "unknown";

      whatsappLog.status = WhatsAppStatus.Success;
      whatsappLog.statusMessage = "Message ID: " + (messageId || "unknown");

      logger.debug("WhatsApp message sent successfully.");
      logger.debug(whatsappLog.statusMessage);

      if (shouldChargeForWhatsApp && project) {
        whatsappLog.whatsAppCostInUSDCents = whatsappCost * 100;

        project.smsOrCallCurrentBalanceInUSDCents = Math.floor(
          project.smsOrCallCurrentBalanceInUSDCents! - whatsappCost * 100,
        );

        await ProjectService.updateOneById({
          data: {
            smsOrCallCurrentBalanceInUSDCents:
              project.smsOrCallCurrentBalanceInUSDCents,
            notEnabledSmsOrCallNotificationSentToOwners: false, // reset this flag
          },
          id: project.id!,
          props: {
            isRoot: true,
          },
        });
      }
    } catch (e: any) {
      whatsappLog.whatsAppCostInUSDCents = 0;
      whatsappLog.status = WhatsAppStatus.Error;
      whatsappLog.statusMessage =
        e && e.message ? e.message.toString() : e.toString();

      logger.error("WhatsApp message failed to send.");
      logger.error(whatsappLog.statusMessage);

      whatsappError = e;
    }

    if (options.projectId) {
      await WhatsAppLogService.create({
        data: whatsappLog,
        props: {
          isRoot: true,
        },
      });
    }

    if (options.userOnCallLogTimelineId) {
      await UserOnCallLogTimelineService.updateOneById({
        data: {
          status:
            whatsappLog.status === WhatsAppStatus.Success
              ? UserNotificationStatus.Sent
              : UserNotificationStatus.Error,
          statusMessage: whatsappLog.statusMessage!,
        },
        id: options.userOnCallLogTimelineId,
        props: {
          isRoot: true,
        },
      });
    }

    if (whatsappError) {
      throw whatsappError;
    }
  }
}