import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import logger from "../Utils/Logger";
import CallService from "./CallService";
import DatabaseService from "./DatabaseService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import SmsService from "./SmsService";
import TeamMemberService from "./TeamMemberService";
import TelegramService from "./TelegramService";
import UserCallService from "./UserCallService";
import UserEmailService from "./UserEmailService";
import UserSmsService from "./UserSmsService";
import PushNotificationService from "./PushNotificationService";
import UserTelegramService from "./UserTelegramService";
import UserSlackService from "./UserSlackService";
import UserMicrosoftTeamsService from "./UserMicrosoftTeamsService";
import UserWebhookService from "./UserWebhookService";
import UserWhatsAppService from "./UserWhatsAppService";
import WebhookService from "./WebhookService";
import WhatsAppService from "./WhatsAppService";
import WorkspaceUserNotificationService from "./WorkspaceUserNotificationService";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import BadDataException from "../../Types/Exception/BadDataException";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import { SMSMessage } from "../../Types/SMS/SMS";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import TelegramMessage, {
  TelegramMessagePayload,
} from "../../Types/Telegram/TelegramMessage";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import WhatsAppMessage, {
  WhatsAppMessagePayload,
} from "../../Types/WhatsApp/WhatsAppMessage";
import { JSONObject } from "../../Types/JSON";
import UserCall from "../../Models/DatabaseModels/UserCall";
import UserEmail from "../../Models/DatabaseModels/UserEmail";
import UserNotificationSetting from "../../Models/DatabaseModels/UserNotificationSetting";
import UserSMS from "../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../Models/DatabaseModels/UserTelegram";
import UserSlack from "../../Models/DatabaseModels/UserSlack";
import UserMicrosoftTeams from "../../Models/DatabaseModels/UserMicrosoftTeams";
import UserWebhook from "../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../Models/DatabaseModels/UserWhatsApp";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../Types/Workspace/WorkspaceMessagePayload";
import EmailRollupWriter from "../Utils/EmailRollup/EmailRollupWriter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { appendRecipientToWhatsAppMessage } from "../Utils/WhatsAppTemplateUtil";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";

export class Service extends DatabaseService<UserNotificationSetting> {
  public constructor() {
    super(UserNotificationSetting);
  }

  @CaptureSpan()
  public async sendUserNotification(data: {
    userId: ObjectID;
    projectId: ObjectID;
    eventType: NotificationSettingEventType;
    emailEnvelope: EmailEnvelope;
    smsMessage: SMSMessage;
    callRequestMessage: CallRequestMessage;
    pushNotificationMessage: PushNotificationMessage;
    /*
     * Optional: WhatsApp only delivers Meta-approved template payloads, so a
     * caller whose event type has no registered template leaves this out and
     * the channel is skipped (the body of this method already guards for it)
     * instead of failing at the notification service.
     */
    whatsAppMessage?: WhatsAppMessagePayload | undefined;
    telegramMessage?: TelegramMessagePayload | undefined;
    /*
     * Bypasses burst coalescing for this send, before any rollup bookkeeping
     * runs. Some producers reuse another family's event type: the SLA-breach
     * job at App/FeatureSet/Workers/Jobs/IncidentSla/CheckSlaBreaches.ts sends
     * under EmailTemplateType.IncidentOwnerResourceCreated at :265 and reuses
     * SEND_INCIDENT_CREATED_OWNER_NOTIFICATION at :286, so the event type
     * alone cannot express that this particular message is urgent. Only a
     * caller knows that, so only a caller can say so.
     */
    forceImmediate?: boolean | undefined;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    alertEpisodeId?: ObjectID | undefined;
    incidentEpisodeId?: ObjectID | undefined;
    monitorId?: ObjectID | undefined;
    scheduledMaintenanceId?: ObjectID | undefined;
    statusPageId?: ObjectID | undefined;
    statusPageAnnouncementId?: ObjectID | undefined;
    teamId?: ObjectID | undefined;
    // OnCall-related fields
    onCallPolicyId?: ObjectID | undefined;
    onCallPolicyEscalationRuleId?: ObjectID | undefined;
    onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
    onCallScheduleId?: ObjectID | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException(
        "ProjectId is required for SendUserNotification",
      );
    }

    const notificationSettings: UserNotificationSetting | null =
      await this.findOneBy({
        query: {
          userId: data.userId,
          projectId: data.projectId,
          eventType: data.eventType,
        },
        select: {
          alertByEmail: true,
          alertBySMS: true,
          alertByWhatsApp: true,
          alertByTelegram: true,
          alertBySlack: true,
          alertByMicrosoftTeams: true,
          alertByCall: true,
          alertByPush: true,
          alertByWebhook: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (notificationSettings) {
      if (notificationSettings.alertByEmail) {
        // get all the emails of the user.
        const userEmails: Array<UserEmail> = await UserEmailService.findBy({
          query: {
            userId: data.userId,
            projectId: data.projectId,
            isVerified: true,
          },
          select: {
            email: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        const emailEnvelope: EmailEnvelope = {
          ...data.emailEnvelope,
          vars: { ...data.emailEnvelope.vars },
        };

        if (userEmails.length > 0) {
          try {
            const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();
            /*
             * Keep this out of the producer's envelope and the other channels.
             * A *Link variable would be mistaken for a resource by the rollup writer.
             */
            emailEnvelope.vars["notificationPreferencesUrl"] = URL.fromString(
              dashboardUrl.toString(),
            )
              .addRoute(
                `/${data.projectId.toString()}/user-settings/notification-settings`,
              )
              .toString();
          } catch (err) {
            // The footer retains navigation instructions if a URL is unavailable.
            logger.error(err);
          }
        }

        for (const userEmail of userEmails) {
          /*
           * The one seam where an owner email can be held back. Below the
           * burst threshold the email is sent immediately with its original
           * subject, template and correlation ids, plus the preferences URL
           * above. Delivery is fire-and-forget inside the writer; above the
           * threshold the message is
           * queued for a rollup instead of dropped. Awaited, unlike the raw
           * send it replaces, because the queue row has to exist before this
           * method returns; the writer itself never awaits MailService.
           *
           * The email-only envelope copy is never mutated by the writer.
           * The original remains unchanged, which the Telegram fallback and Slack /
           * Microsoft Teams bodies further down depend on: all three
           * synthesise their message from data.emailEnvelope.subject.
           *
           * Guarded even though sendOrRollup is written not to throw. The send
           * it replaces was fire-and-forget, so one bad address could never
           * cost another address its email - let alone cost this notification
           * its SMS, call, push, Telegram, workspace and webhook deliveries
           * further down. Awaiting reintroduces that possibility; this catch
           * takes it back out.
           */
          try {
            await EmailRollupWriter.sendOrRollup({
              projectId: data.projectId,
              userId: data.userId,
              toEmail: userEmail.email!,
              eventType: data.eventType,
              emailEnvelope: emailEnvelope,
              mailOptions: {
                projectId: data.projectId,
                incidentId: data.incidentId,
                alertId: data.alertId,
                alertEpisodeId: data.alertEpisodeId,
                incidentEpisodeId: data.incidentEpisodeId,
                monitorId: data.monitorId,
                scheduledMaintenanceId: data.scheduledMaintenanceId,
                statusPageId: data.statusPageId,
                statusPageAnnouncementId: data.statusPageAnnouncementId,
                userId: data.userId,
                teamId: data.teamId,
                // OnCall-related fields
                onCallPolicyId: data.onCallPolicyId,
                onCallPolicyEscalationRuleId: data.onCallPolicyEscalationRuleId,
                onCallDutyPolicyExecutionLogTimelineId:
                  data.onCallDutyPolicyExecutionLogTimelineId,
                onCallScheduleId: data.onCallScheduleId,
              },
              ...(data.forceImmediate !== undefined && {
                forceImmediate: data.forceImmediate,
              }),
            });
          } catch (err) {
            logger.error(err);
          }
        }
      }

      /*
       * If the project has a default Twilio config set, all SMS and Calls
       * sent to project team members will use it instead of the global config.
       */
      const projectTwilioConfig: TwilioConfig | undefined =
        await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
          data.projectId,
        );

      if (notificationSettings.alertBySMS) {
        const userSmses: Array<UserSMS> = await UserSmsService.findBy({
          query: {
            userId: data.userId,
            projectId: data.projectId,
            isVerified: true,
          },
          select: {
            phone: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        for (const userSms of userSmses) {
          SmsService.sendSms(
            {
              ...data.smsMessage,
              to: userSms.phone!,
            },
            {
              projectId: data.projectId,
              customTwilioConfig: projectTwilioConfig,
              incidentId: data.incidentId,
              alertId: data.alertId,
              alertEpisodeId: data.alertEpisodeId,
              incidentEpisodeId: data.incidentEpisodeId,
              monitorId: data.monitorId,
              scheduledMaintenanceId: data.scheduledMaintenanceId,
              statusPageId: data.statusPageId,
              statusPageAnnouncementId: data.statusPageAnnouncementId,
              userId: data.userId,
              teamId: data.teamId,
              // OnCall-related fields
              onCallPolicyId: data.onCallPolicyId,
              onCallPolicyEscalationRuleId: data.onCallPolicyEscalationRuleId,
              onCallDutyPolicyExecutionLogTimelineId:
                data.onCallDutyPolicyExecutionLogTimelineId,
              onCallScheduleId: data.onCallScheduleId,
            },
          ).catch((err: Error) => {
            logger.error(err);
          });
        }
      }

      if (notificationSettings.alertByWhatsApp) {
        const userWhatsApps: Array<UserWhatsApp> =
          await UserWhatsAppService.findBy({
            query: {
              userId: data.userId,
              projectId: data.projectId,
              isVerified: true,
            },
            select: {
              phone: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        if (!data.whatsAppMessage) {
          logger.warn(
            "Skipping WhatsApp notification because WhatsApp template payload is missing.",
          );
        } else {
          for (const userWhatsApp of userWhatsApps) {
            const whatsAppMessage: WhatsAppMessage =
              appendRecipientToWhatsAppMessage(
                data.whatsAppMessage,
                userWhatsApp.phone!,
              );

            WhatsAppService.sendWhatsAppMessage(whatsAppMessage, {
              projectId: data.projectId,
              incidentId: data.incidentId,
              alertId: data.alertId,
              alertEpisodeId: data.alertEpisodeId,
              incidentEpisodeId: data.incidentEpisodeId,
              monitorId: data.monitorId,
              scheduledMaintenanceId: data.scheduledMaintenanceId,
              statusPageId: data.statusPageId,
              statusPageAnnouncementId: data.statusPageAnnouncementId,
              userId: data.userId,
              teamId: data.teamId,
              onCallPolicyId: data.onCallPolicyId,
              onCallPolicyEscalationRuleId: data.onCallPolicyEscalationRuleId,
              onCallDutyPolicyExecutionLogTimelineId:
                data.onCallDutyPolicyExecutionLogTimelineId,
              onCallScheduleId: data.onCallScheduleId,
            }).catch((err: Error) => {
              logger.error(err);
            });
          }
        }
      }

      if (notificationSettings.alertByTelegram) {
        const userTelegrams: Array<UserTelegram> =
          await UserTelegramService.findBy({
            query: {
              userId: data.userId,
              projectId: data.projectId,
              isVerified: true,
            },
            select: {
              telegramChatId: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        /*
         * When the caller did not provide a Telegram-specific message we build a
         * nicely-formatted HTML body from the email subject + SMS body + optional
         * URL from the email envelope, with a 🔔 prefix. If they did provide one,
         * we respect their body/parseMode verbatim.
         */
        const callerProvidedTelegramBody: boolean = Boolean(
          data.telegramMessage?.body,
        );

        const escapeHtml: (value: string) => string = (
          value: string,
        ): string => {
          return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        };

        let telegramBody: string = "";
        let telegramParseMode: TelegramMessage["parseMode"] | undefined =
          undefined;

        if (callerProvidedTelegramBody) {
          telegramBody = data.telegramMessage!.body;
          telegramParseMode = data.telegramMessage!.parseMode;
        } else {
          const subject: string = data.emailEnvelope.subject || "";
          const smsBody: string = data.smsMessage.message || "";

          if (subject || smsBody) {
            const lines: Array<string> = [];
            if (subject) {
              lines.push(`🔔 <b>${escapeHtml(subject)}</b>`);
            } else {
              lines.push("🔔 <b>OneUptime notification</b>");
            }
            if (smsBody) {
              lines.push("");
              lines.push(escapeHtml(smsBody));
            }
            telegramBody = lines.join("\n");
            telegramParseMode = "HTML";
          }
        }

        if (!telegramBody) {
          logger.warn(
            "Skipping Telegram notification because message body is empty.",
          );
        } else {
          for (const userTelegram of userTelegrams) {
            if (!userTelegram.telegramChatId) {
              continue;
            }

            const telegramMessage: TelegramMessage = {
              to: userTelegram.telegramChatId,
              body: telegramBody,
              parseMode: telegramParseMode,
              disableWebPagePreview:
                data.telegramMessage?.disableWebPagePreview ?? true,
            };

            TelegramService.sendTelegramMessage(telegramMessage, {
              projectId: data.projectId,
              incidentId: data.incidentId,
              alertId: data.alertId,
              alertEpisodeId: data.alertEpisodeId,
              incidentEpisodeId: data.incidentEpisodeId,
              monitorId: data.monitorId,
              scheduledMaintenanceId: data.scheduledMaintenanceId,
              statusPageId: data.statusPageId,
              statusPageAnnouncementId: data.statusPageAnnouncementId,
              userId: data.userId,
              teamId: data.teamId,
              onCallPolicyId: data.onCallPolicyId,
              onCallPolicyEscalationRuleId: data.onCallPolicyEscalationRuleId,
              onCallDutyPolicyExecutionLogTimelineId:
                data.onCallDutyPolicyExecutionLogTimelineId,
              onCallScheduleId: data.onCallScheduleId,
            }).catch((err: Error) => {
              logger.error(err);
            });
          }
        }
      }

      if (
        notificationSettings.alertBySlack ||
        notificationSettings.alertByMicrosoftTeams
      ) {
        /*
         * Slack and Microsoft Teams share one derived message: callers hand
         * this method channel payloads for the older channels only, so the
         * workspace body is synthesised from the email subject + SMS body the
         * same way the Telegram fallback body is. Standard markdown — Slack
         * slackifies it and Teams renders it into an adaptive card.
         */
        const subject: string = data.emailEnvelope.subject || "";
        const smsBody: string = data.smsMessage.message || "";

        let workspaceMarkdown: string = "";

        if (subject || smsBody) {
          const lines: Array<string> = [];
          lines.push(`🔔 **${subject || "OneUptime notification"}**`);
          if (smsBody) {
            lines.push("");
            lines.push(smsBody);
          }
          workspaceMarkdown = lines.join("\n");
        }

        if (!workspaceMarkdown) {
          logger.warn(
            "Skipping workspace notification because message body is empty.",
          );
        } else {
          const markdownBlock: WorkspacePayloadMarkdown = {
            _type: "WorkspacePayloadMarkdown",
            text: workspaceMarkdown,
          };
          const messageBlocks: Array<WorkspaceMessageBlock> = [markdownBlock];

          if (notificationSettings.alertBySlack) {
            const userSlacks: Array<UserSlack> = await UserSlackService.findBy({
              query: {
                userId: data.userId,
                projectId: data.projectId,
                isVerified: true,
              },
              select: {
                slackUserId: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

            for (const userSlack of userSlacks) {
              if (!userSlack.slackUserId) {
                continue;
              }

              WorkspaceUserNotificationService.sendDirectMessageToUser({
                projectId: data.projectId,
                workspaceType: WorkspaceType.Slack,
                workspaceUserId: userSlack.slackUserId,
                messageBlocks: messageBlocks,
                messageSummary: subject || smsBody,
                userId: data.userId,
                incidentId: data.incidentId,
                alertId: data.alertId,
                alertEpisodeId: data.alertEpisodeId,
                incidentEpisodeId: data.incidentEpisodeId,
                teamId: data.teamId,
                onCallPolicyId: data.onCallPolicyId,
                onCallPolicyEscalationRuleId: data.onCallPolicyEscalationRuleId,
                onCallScheduleId: data.onCallScheduleId,
              }).catch((err: Error) => {
                logger.error(err);
              });
            }
          }

          if (notificationSettings.alertByMicrosoftTeams) {
            const userMicrosoftTeamsAccounts: Array<UserMicrosoftTeams> =
              await UserMicrosoftTeamsService.findBy({
                query: {
                  userId: data.userId,
                  projectId: data.projectId,
                  isVerified: true,
                },
                select: {
                  microsoftTeamsUserId: true,
                },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                props: {
                  isRoot: true,
                },
              });

            for (const userMicrosoftTeams of userMicrosoftTeamsAccounts) {
              if (!userMicrosoftTeams.microsoftTeamsUserId) {
                continue;
              }

              WorkspaceUserNotificationService.sendDirectMessageToUser({
                projectId: data.projectId,
                workspaceType: WorkspaceType.MicrosoftTeams,
                workspaceUserId: userMicrosoftTeams.microsoftTeamsUserId,
                messageBlocks: messageBlocks,
                messageSummary: subject || smsBody,
                userId: data.userId,
                incidentId: data.incidentId,
                alertId: data.alertId,
                alertEpisodeId: data.alertEpisodeId,
                incidentEpisodeId: data.incidentEpisodeId,
                teamId: data.teamId,
                onCallPolicyId: data.onCallPolicyId,
                onCallPolicyEscalationRuleId: data.onCallPolicyEscalationRuleId,
                onCallScheduleId: data.onCallScheduleId,
              }).catch((err: Error) => {
                logger.error(err);
              });
            }
          }
        }
      }

      if (notificationSettings.alertByCall) {
        const userCalls: Array<UserCall> = await UserCallService.findBy({
          query: {
            userId: data.userId,
            projectId: data.projectId,
            isVerified: true,
          },
          select: {
            phone: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        for (const userCall of userCalls) {
          CallService.makeCall(
            {
              ...data.callRequestMessage,
              to: userCall.phone!,
            },
            {
              projectId: data.projectId,
              customTwilioConfig: projectTwilioConfig,
              incidentId: data.incidentId,
              alertId: data.alertId,
              alertEpisodeId: data.alertEpisodeId,
              incidentEpisodeId: data.incidentEpisodeId,
              monitorId: data.monitorId,
              scheduledMaintenanceId: data.scheduledMaintenanceId,
              statusPageId: data.statusPageId,
              statusPageAnnouncementId: data.statusPageAnnouncementId,
              userId: data.userId,
              teamId: data.teamId,
              // OnCall-related fields
              onCallPolicyId: data.onCallPolicyId,
              onCallPolicyEscalationRuleId: data.onCallPolicyEscalationRuleId,
              onCallDutyPolicyExecutionLogTimelineId:
                data.onCallDutyPolicyExecutionLogTimelineId,
              onCallScheduleId: data.onCallScheduleId,
            },
          ).catch((err: Error) => {
            logger.error(err);
          });
        }
      }

      if (notificationSettings.alertByPush) {
        logger.debug(
          `Sending push notification to user ${data.userId.toString()} for event ${data.eventType}`,
        );
        PushNotificationService.sendPushNotificationToUser(
          data.userId,
          data.projectId,
          data.pushNotificationMessage,
          {
            projectId: data.projectId,
            userId: data.userId,
            teamId: data.teamId,
            monitorId: data.monitorId,
            // OnCall-related fields
            onCallPolicyId: data.onCallPolicyId,
            onCallPolicyEscalationRuleId: data.onCallPolicyEscalationRuleId,
            onCallDutyPolicyExecutionLogTimelineId:
              data.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: data.onCallScheduleId,
          },
        ).catch((err: Error) => {
          logger.error(err);
        });
      }

      if (notificationSettings.alertByWebhook) {
        const userWebhooks: Array<UserWebhook> =
          await UserWebhookService.findBy({
            query: {
              userId: data.userId,
              projectId: data.projectId,
            },
            select: {
              webhookUrl: true,
              secret: true,
              name: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        const webhookPayload: JSONObject = {
          eventType: data.eventType,
          timestamp: new Date().toISOString(),
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
          subject: data.emailEnvelope?.subject || "",
          message: data.smsMessage?.message || "",
        };

        if (data.incidentId) {
          webhookPayload["incidentId"] = data.incidentId.toString();
        }
        if (data.alertId) {
          webhookPayload["alertId"] = data.alertId.toString();
        }
        if (data.monitorId) {
          webhookPayload["monitorId"] = data.monitorId.toString();
        }
        if (data.scheduledMaintenanceId) {
          webhookPayload["scheduledMaintenanceId"] =
            data.scheduledMaintenanceId.toString();
        }
        if (data.statusPageId) {
          webhookPayload["statusPageId"] = data.statusPageId.toString();
        }
        if (data.statusPageAnnouncementId) {
          webhookPayload["statusPageAnnouncementId"] =
            data.statusPageAnnouncementId.toString();
        }
        if (data.onCallPolicyId) {
          webhookPayload["onCallPolicyId"] = data.onCallPolicyId.toString();
        }
        if (data.onCallPolicyEscalationRuleId) {
          webhookPayload["onCallPolicyEscalationRuleId"] =
            data.onCallPolicyEscalationRuleId.toString();
        }

        for (const userWebhook of userWebhooks) {
          if (!userWebhook.webhookUrl) {
            continue;
          }

          WebhookService.sendWebhook(
            {
              url: userWebhook.webhookUrl,
              eventType: data.eventType,
              payload: webhookPayload,
              secret: userWebhook.secret,
            },
            {
              projectId: data.projectId,
              incidentId: data.incidentId,
              alertId: data.alertId,
              monitorId: data.monitorId,
              scheduledMaintenanceId: data.scheduledMaintenanceId,
              statusPageId: data.statusPageId,
              statusPageAnnouncementId: data.statusPageAnnouncementId,
              userId: data.userId,
              teamId: data.teamId,
              onCallPolicyId: data.onCallPolicyId,
              onCallPolicyEscalationRuleId: data.onCallPolicyEscalationRuleId,
              onCallDutyPolicyExecutionLogTimelineId:
                data.onCallDutyPolicyExecutionLogTimelineId,
              onCallScheduleId: data.onCallScheduleId,
            },
          ).catch((err: Error) => {
            logger.error(err);
          });
        }
      }
    }
  }

  @CaptureSpan()
  public async removeDefaultNotificationSettingsForUser(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    // check if this user is not in the project anymore.
    const count: PositiveNumber = await TeamMemberService.countBy({
      query: {
        projectId,
        userId,
        hasAcceptedInvitation: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (count.toNumber() === 0) {
      await this.deleteBy({
        query: {
          projectId,
          userId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public async addDefaultNotificationSettingsForUser(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addProbeOwnerNotificationSettings(userId, projectId);
    await this.addIncidentNotificationSettings(userId, projectId);
    await this.addMonitorNotificationSettings(userId, projectId);
    await this.addOnCallNotificationSettings(userId, projectId);
    await this.addAlertNotificationSettings(userId, projectId);
    await this.addAlertEpisodeNotificationSettings(userId, projectId);
    await this.addIncidentEpisodeNotificationSettings(userId, projectId);
    await this.addScheduledMaintenanceNotificationSettings(userId, projectId);
    await this.addSloNotificationSettings(userId, projectId);
  }

  private async addSloNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_SLO_OWNER_ADDED_NOTIFICATION,
    );
  }

  private async addScheduledMaintenanceNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_REMINDER_OWNER_NOTIFICATION,
    );
  }

  private async addProbeOwnerNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION,
    );
  }

  private async addIncidentNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_INCIDENT_REMINDER_OWNER_NOTIFICATION,
    );
  }

  private async addMonitorNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES,
    );
  }

  public async addOnCallNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
    );

    await this.addShiftReminderNotificationSettings(userId, projectId);
  }

  /*
   * The two shift-reminder events ("before my shift starts", "my upcoming
   * shift is reassigned"). Email AND push on by default: a reminder that
   * only lands in a mailbox is easy to miss at 05:45, and both are the
   * user's own lead times, not a page. Idempotent — the
   * AddShiftReminderNotificationSettingsForUsers data migration calls this
   * for every existing member, and sendUserNotification sends nothing
   * without a row, so this is what makes the reminder worker's output
   * non-zero for users who joined before the events existed.
   */
  @CaptureSpan()
  public async addShiftReminderNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
      { alertByPush: true },
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
      { alertByPush: true },
    );
  }

  private async addAlertNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_ALERT_REMINDER_OWNER_NOTIFICATION,
    );
  }

  private async addAlertEpisodeNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_ALERT_EPISODE_CREATED_OWNER_NOTIFICATION,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_ALERT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_ALERT_ADDED_TO_EPISODE_OWNER_NOTIFICATION,
    );
  }

  private async addIncidentEpisodeNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_INCIDENT_EPISODE_CREATED_OWNER_NOTIFICATION,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_INCIDENT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION,
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_INCIDENT_ADDED_TO_EPISODE_OWNER_NOTIFICATION,
    );
  }

  /*
   * Ensures a UserNotificationSetting row exists for the given user, project
   * and event type. If no row exists, a default-enabled (email) row is
   * created. This is useful for event types added after a user joined a
   * project, since sendUserNotification no-ops when no row exists.
   */
  @CaptureSpan()
  public async ensureSettingExistsForUser(data: {
    userId: ObjectID;
    projectId: ObjectID;
    eventType: NotificationSettingEventType;
  }): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      data.userId,
      data.projectId,
      data.eventType,
    );
  }

  private async addNotificationSettingIfNotExists(
    userId: ObjectID,
    projectId: ObjectID,
    eventType: NotificationSettingEventType,
    options?: { alertByPush?: boolean | undefined },
  ): Promise<void> {
    const existingNotification: PositiveNumber = await this.countBy({
      query: {
        userId,
        projectId,
        eventType,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingNotification.toNumber() === 0) {
      const item: UserNotificationSetting = new UserNotificationSetting();
      item.userId = userId;
      item.projectId = projectId;
      item.eventType = eventType;
      item.alertByEmail = true;

      if (options?.alertByPush) {
        item.alertByPush = true;
      }

      await this.create({
        data: item,
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<UserNotificationSetting>,
  ): Promise<OnCreate<UserNotificationSetting>> {
    // check if the same event for same user is added.
    if (!createBy.data.projectId) {
      throw new BadDataException(
        "ProjectId is required for UserNotificationSetting",
      );
    }

    if (!createBy.data.userId) {
      throw new BadDataException(
        "UserId is required for UserNotificationSetting",
      );
    }

    if (!createBy.data.eventType) {
      throw new BadDataException(
        "EventType is required for UserNotificationSetting",
      );
    }

    const count: PositiveNumber = await this.countBy({
      query: {
        projectId: createBy.data.projectId,
        userId: createBy.data.userId,
        eventType: createBy.data.eventType,
      },
      props: {
        isRoot: true,
      },
    });

    if (count.toNumber() > 0) {
      throw new BadDataException(
        "Notification Setting of the same event type already exists for the user.",
      );
    }

    return {
      createBy,
      carryForward: undefined,
    };
  }
}

export default new Service();
