import {
  WhatsAppTextDefaultCostInCents,
  getMetaWhatsAppConfig,
  MetaWhatsAppConfig,
  DEFAULT_META_WHATSAPP_API_VERSION,
} from "../Config";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import WhatsAppMessage from "Common/Types/WhatsApp/WhatsAppMessage";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
import {
  AuthenticationTemplates,
  WhatsAppTemplateId,
} from "Common/Types/WhatsApp/WhatsAppTemplates";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import WhatsAppLogService from "Common/Server/Services/WhatsAppLogService";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import ProjectBalanceOwnerNotice from "Common/Server/Utils/ProjectBalanceOwnerNotice";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import SafeHtml from "Common/Types/SafeHtml";
import { ProjectNotificationChannel } from "Common/Utils/Project/NotificationChannels";
import {
  getProjectBalanceMessageNotSentReason,
  getProjectBalanceShortfallSentence,
  ProjectBalanceType,
} from "Common/Utils/Project/ProjectBalance";
import Project from "Common/Models/DatabaseModels/Project";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";
import API from "Common/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { fitWhatsAppTemplateVariables } from "Common/Utils/WhatsAppTemplateFit";

const SENSITIVE_MESSAGE_PLACEHOLDER: string =
  "This message is sensitive and is not logged";

export default class WhatsAppService {
  public static async sendWhatsApp(
    message: WhatsAppMessage,
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
    const whatsAppLog: WhatsAppLog = new WhatsAppLog();

    try {
      if (!message.to) {
        throw new BadDataException(
          "WhatsApp recipient phone number is required",
        );
      }

      if (!message.body && !message.templateKey) {
        throw new BadDataException(
          "Either WhatsApp message body or template key must be provided",
        );
      }

      const isSensitiveMessage: boolean = Boolean(options.isSensitive);
      const messageSummary: string = isSensitiveMessage
        ? SENSITIVE_MESSAGE_PLACEHOLDER
        : message.body ||
          (message.templateKey
            ? `Template: ${message.templateKey}${
                message.templateVariables
                  ? " Variables: " + JSON.stringify(message.templateVariables)
                  : ""
              }`
            : "");

      whatsAppLog.toNumber = message.to;
      whatsAppLog.messageText = messageSummary;
      whatsAppLog.whatsAppCostInUSDCents = 0;

      if (options.projectId) {
        whatsAppLog.projectId = options.projectId;
      }

      if (options.incidentId) {
        whatsAppLog.incidentId = options.incidentId;
      }

      if (options.alertId) {
        whatsAppLog.alertId = options.alertId;
      }

      if (options.monitorId) {
        whatsAppLog.monitorId = options.monitorId;
      }

      if (options.scheduledMaintenanceId) {
        whatsAppLog.scheduledMaintenanceId = options.scheduledMaintenanceId;
      }

      if (options.statusPageId) {
        whatsAppLog.statusPageId = options.statusPageId;
      }

      if (options.statusPageAnnouncementId) {
        whatsAppLog.statusPageAnnouncementId = options.statusPageAnnouncementId;
      }

      if (options.userId) {
        whatsAppLog.userId = options.userId;
      }

      if (options.teamId) {
        whatsAppLog.teamId = options.teamId;
      }

      if (options.onCallPolicyId) {
        whatsAppLog.onCallDutyPolicyId = options.onCallPolicyId;
      }

      if (options.onCallPolicyEscalationRuleId) {
        whatsAppLog.onCallDutyPolicyEscalationRuleId =
          options.onCallPolicyEscalationRuleId;
      }

      if (options.onCallScheduleId) {
        whatsAppLog.onCallDutyPolicyScheduleId = options.onCallScheduleId;
      }

      const config: MetaWhatsAppConfig = await getMetaWhatsAppConfig();

      const shouldChargeForMessage: boolean = IsBillingEnabled;

      // What it costs, in whole cents.
      const messageCostInUSDCents: number = shouldChargeForMessage
        ? MessagingBalance.getCostInUSDCents({
            costPerPartInUSDCents: WhatsAppTextDefaultCostInCents,
          })
        : 0;

      let project: Project | null = null;

      if (options.projectId) {
        project = await ProjectService.findOneById({
          id: options.projectId,
          select: {
            smsOrCallCurrentBalanceInUSDCents: true,
            lowCallAndSMSBalanceNotificationSentToOwners: true,
            name: true,
            notEnabledSmsOrCallNotificationSentToOwners: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (!project) {
          whatsAppLog.status = WhatsAppStatus.Error;
          whatsAppLog.statusMessage = `Project ${options.projectId.toString()} not found.`;
          logger.error(whatsAppLog.statusMessage);
          await WhatsAppLogService.create({
            data: whatsAppLog,
            props: {
              isRoot: true,
            },
          });
          await UserOnCallLogTimelineService.markNotSent({
            userOnCallLogTimelineId: options.userOnCallLogTimelineId,
            reason: whatsAppLog.statusMessage!,
          });
          return;
        }

        if (shouldChargeForMessage) {
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

          /*
           * Nothing left, or less than this message costs. The log (which
           * the project's members read, as they read a person's on-call
           * timeline) says who can add balance and where; the owners, who
           * may, are told to, with a link - once, until the balance is
           * topped up again (Utils/Project/ProjectBalance). The message goes
           * into their email as text: it carries incident titles and other
           * typed values, so any markup in it is shown, not rendered.
           */
          const balanceInUSDCents: number =
            project.smsOrCallCurrentBalanceInUSDCents || 0;

          if (!balanceInUSDCents || balanceInUSDCents < messageCostInUSDCents) {
            const shortfall: {
              channel: ProjectNotificationChannel;
              balanceInUSDCents: number;
              costInUSDCents: number;
            } = {
              channel: ProjectNotificationChannel.WhatsApp,
              balanceInUSDCents: balanceInUSDCents,
              costInUSDCents: messageCostInUSDCents,
            };

            whatsAppLog.status = WhatsAppStatus.LowBalance;
            whatsAppLog.statusMessage =
              getProjectBalanceMessageNotSentReason(shortfall);
            // Tenant billing state, not a defect — the owners get emailed below.
            logger.error(whatsAppLog.statusMessage, EXTERNAL_FAULT);

            await WhatsAppLogService.create({
              data: whatsAppLog,
              props: {
                isRoot: true,
              },
            });

            // Once each time it runs out, whatever else finds it out too.
            if (
              await MessagingBalance.shouldTellOwnersBalanceIsLow({
                projectId: project.id!,
                alreadyTold:
                  project.lowCallAndSMSBalanceNotificationSentToOwners,
              })
            ) {
              await ProjectService.sendEmailToProjectOwners(
                project.id!,
                `Low WhatsApp message balance for ${project.name || ""}`,
                `We tried to send a WhatsApp message to ${SafeHtml.escape(
                  message.to.toString(),
                )} with message:<br/><br/>${SafeHtml.escape(
                  messageSummary,
                )}<br/><br/>This WhatsApp message was not sent. ${SafeHtml.escape(
                  getProjectBalanceShortfallSentence(shortfall),
                )} ${ProjectBalanceOwnerNotice.getHtml({
                  balance: ProjectBalanceType.SmsOrCall,
                  projectId: project.id!,
                })}`,
              );
            }
            await UserOnCallLogTimelineService.markNotSent({
              userOnCallLogTimelineId: options.userOnCallLogTimelineId,
              reason: whatsAppLog.statusMessage!,
            });
            return;
          }
        }
      }

      const payload: JSONObject = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: message.to.toString(),
      } as JSONObject;

      if (!message.templateKey) {
        throw new BadDataException("WhatsApp message template key is required");
      }

      if (message.templateKey) {
        const template: JSONObject = {
          name: message.templateKey,
          language: {
            code: message.templateLanguageCode || "en",
          },
        } as JSONObject;

        const components: JSONArray = [];

        /*
         * Meta refuses a template whose text, its variables filled in, is
         * more than 1,024 characters, and the message is lost: the longest
         * variables are cut to fit (fitWhatsAppTemplateVariables).
         */
        const templateVariables: Record<string, string> | undefined =
          fitWhatsAppTemplateVariables(
            message.templateKey,
            message.templateVariables,
          );

        if (templateVariables && Object.keys(templateVariables).length > 0) {
          const parameters: JSONArray = [];

          for (const [key, value] of Object.entries(templateVariables)) {
            parameters.push({
              type: "text",
              parameter_name: key,
              text: value,
            } as JSONObject);
          }

          if (parameters.length > 0) {
            components.push({
              type: "body",
              parameters,
            } as JSONObject);
          }
        }

        /*
         * Check if this is an authentication template
         * Authentication templates may have special requirements including button components
         */
        const isAuthTemplate: boolean = AuthenticationTemplates.has(
          message.templateKey as WhatsAppTemplateId,
        );

        if (isAuthTemplate) {
          logger.info(
            `Sending authentication template: ${message.templateKey}`,
          );

          /*
           * Authentication templates in WhatsApp may have a button component for "Copy Code"
           * If the template was created with a button, we need to provide button parameters
           */
          if (message.templateVariables) {
            const otpCode: string | undefined =
              message.templateVariables["1"] ||
              message.templateVariables["otp"] ||
              message.templateVariables["code"];

            if (otpCode) {
              /*
               * Add button component - the index should match the button position in the template
               * Usually authentication templates have the button as the first (and only) button
               */
              components.push({
                type: "button",
                sub_type: "url",
                index: 0,
                parameters: [
                  {
                    type: "text",
                    text: otpCode,
                  },
                ],
              } as JSONObject);
            }
          }
        }

        if (components.length > 0) {
          template["components"] = components;
        }

        payload["type"] = "template";
        payload["template"] = template;
      } else {
        payload["type"] = "text";
        payload["text"] = {
          body: message.body || "",
        } as JSONObject;
      }

      const apiVersion: string =
        config.apiVersion?.trim() || DEFAULT_META_WHATSAPP_API_VERSION;

      const url: URL = new URL(
        Protocol.HTTPS,
        "graph.facebook.com",
        new Route(`${apiVersion}/${config.phoneNumberId}/messages`),
      );

      logger.debug(`WhatsApp API request: ${JSON.stringify(payload)}`);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url,
          data: payload,
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            "Content-Type": "application/json",
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error("Failed to send WhatsApp message.");
        logger.error(response);
        const responseDataAsJSONObject: JSONObject = response.data;
        const responseJsonAsJSONObject: JSONObject | undefined =
          (response.jsonData as JSONObject | undefined) || undefined;

        // Log full error details for debugging
        const errorObject: JSONObject | undefined =
          (responseDataAsJSONObject["error"] as JSONObject | undefined) ||
          (responseJsonAsJSONObject?.["error"] as JSONObject | undefined);

        if (errorObject) {
          logger.error("WhatsApp API Error Details:");
          logger.error(JSON.stringify(errorObject, null, 2));
        }

        const detailedErrorMessage: string | undefined =
          ((responseDataAsJSONObject["error"] as JSONObject | undefined)?.[
            "message"
          ] as string | undefined) ||
          ((responseJsonAsJSONObject?.["error"] as JSONObject | undefined)?.[
            "message"
          ] as string | undefined);

        throw new BadDataException(
          detailedErrorMessage || "Failed to send WhatsApp message.",
        );
      }

      const responseData: JSONObject = (response.jsonData || {}) as JSONObject;

      let messageId: string | undefined = undefined;
      const messagesArray: JSONArray | undefined =
        (responseData["messages"] as JSONArray) || undefined;

      if (Array.isArray(messagesArray) && messagesArray.length > 0) {
        const firstMessage: JSONObject = messagesArray[0] as JSONObject;
        if (firstMessage["id"]) {
          messageId = firstMessage["id"] as string;
        }
      }

      if (messageId) {
        whatsAppLog.whatsAppMessageId = messageId;
      }

      whatsAppLog.status = WhatsAppStatus.Sent;
      whatsAppLog.statusMessage = messageId
        ? `Message ID: ${messageId}`
        : "WhatsApp message sent successfully";

      if (shouldChargeForMessage && project) {
        whatsAppLog.whatsAppCostInUSDCents = messageCostInUSDCents;

        // Paid in one statement, from whatever the balance is now.
        await MessagingBalance.payForSentMessage({
          projectId: project.id!,
          channel: ProjectNotificationChannel.WhatsApp,
          costInUSDCents: messageCostInUSDCents,
        });
      }
    } catch (error: any) {
      logger.error("Failed to send WhatsApp message.");
      logger.error(error);
      whatsAppLog.whatsAppCostInUSDCents = 0;
      whatsAppLog.status = WhatsAppStatus.Error;
      const errorMessage: string =
        error && error.message ? error.message.toString() : `${error}`;
      whatsAppLog.statusMessage = errorMessage;

      sendError = error;
    }

    if (options.projectId) {
      await WhatsAppLogService.create({
        data: whatsAppLog,
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
            WhatsAppStatus.Success,
            WhatsAppStatus.Sent,
            WhatsAppStatus.Delivered,
            WhatsAppStatus.Read,
          ].includes(whatsAppLog.status || WhatsAppStatus.Error)
            ? UserNotificationStatus.Sent
            : UserNotificationStatus.Error,
          statusMessage: whatsAppLog.statusMessage,
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
