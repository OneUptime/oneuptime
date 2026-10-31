import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
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
import SecurityCasePriorities from "../../Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseValues from "../Utils/SecurityCase/SecurityCaseValues";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
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
import ProjectMembership from "../Utils/TeamMember/ProjectMembership";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { appendRecipientToWhatsAppMessage } from "../Utils/WhatsAppTemplateUtil";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";
import { fitNotificationSmsForSending } from "../../Utils/Sms/NotificationSms";
import ProductBrandingText from "../Utils/ProductBrandingText";
import CustomNotificationChannelService from "./CustomNotificationChannelService";
import CustomNotificationChannelDeliveryService, {
  CustomChannelDeliveryResult,
} from "./CustomNotificationChannelDeliveryService";
import ProjectService from "./ProjectService";
import UserService from "./UserService";
import CustomNotificationChannel from "../../Models/DatabaseModels/CustomNotificationChannel";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";
import OneUptimeDate from "../../Types/Date";
import {
  buildCustomChannelNotificationPayload,
  CustomChannelEvent,
} from "../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";

// The events SecurityCaseNotifications sends, in the order the settings list them.
export const SECURITY_CASE_NOTIFICATION_EVENT_TYPES: ReadonlyArray<NotificationSettingEventType> =
  [
    NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
    NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
    NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
    NotificationSettingEventType.SEND_SECURITY_CASE_TARGET_NOTIFICATION,
    NotificationSettingEventType.SEND_SECURITY_CASE_TASK_ASSIGNED_NOTIFICATION,
  ];

// The events SecurityHuntNotifications sends, in the order the settings list them.
export const SECURITY_HUNT_NOTIFICATION_EVENT_TYPES: ReadonlyArray<NotificationSettingEventType> =
  [NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION];

// The setting's priority choice, by either spelling: the ID column first.
const MINIMUM_PRIORITY_KEYS: Array<string> = [
  "minimumSecurityCasePriorityId",
  "minimumSecurityCasePriority",
];

/*
 * A setting's priority choice (minimumSecurityCasePriorityId) is one of the
 * setting's project's case priorities, or nothing, and only the New Security
 * Case setting has one.
 */
async function checkMinimumSecurityCasePriority(data: {
  minimumSecurityCasePriorityId: ObjectID | null;
  eventType: unknown;
  projectIds: Array<ObjectID>;
}): Promise<void> {
  if (!data.minimumSecurityCasePriorityId) {
    return;
  }

  if (
    data.eventType !== undefined &&
    data.eventType !==
      NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION
  ) {
    throw new BadDataException(
      "Only the New Security Case setting has a priority to choose.",
    );
  }

  for (const projectId of data.projectIds) {
    if (
      !SecurityCasePriorities.find(
        await SecurityCaseValues.getPriorities(projectId),
        data.minimumSecurityCasePriorityId,
      )
    ) {
      throw new BadDataException(
        "Choose one of this project's security case priorities.",
      );
    }
  }
}

/*
 * The channels an SLA breach (SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION)
 * starts on for a person who has no setting for it yet: email, as every
 * member starts, and every other channel they have on for "Incident
 * created" - the setting an SLA breach was sent through until it had one of
 * its own, so nobody stops hearing of breaches where they heard of them.
 * Email even when "Incident created" is off: switching that off was never
 * meant to silence SLA breaches, which is why they are apart now
 * (addIncidentSlaBreachedNotificationSettings).
 */
export type NotificationSettingChannel =
  | "alertByEmail"
  | "alertBySMS"
  | "alertByCall"
  | "alertByPush"
  | "alertByWhatsApp"
  | "alertByTelegram"
  | "alertBySlack"
  | "alertByMicrosoftTeams"
  | "alertByWebhook"
  | "alertByCustomChannel";

export const SLA_BREACH_CHANNELS: ReadonlyArray<NotificationSettingChannel> = [
  "alertByEmail",
  "alertBySMS",
  "alertByCall",
  "alertByPush",
  "alertByWhatsApp",
  "alertByTelegram",
  "alertBySlack",
  "alertByMicrosoftTeams",
  "alertByWebhook",
  "alertByCustomChannel",
];

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
     * runs: for a message that is urgent although its event type can be
     * rolled up - a critical security case's (SecurityCaseNotifications), for
     * one. Only a caller knows that, so only a caller can say so. An event
     * that is never urgent enough to wait has no need of it: it is one of
     * NEVER_ROLLED_UP_EVENT_TYPES, as an SLA breach is.
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
    // The case a security notification is about, for the person's webhook.
    securityCaseId?: ObjectID | undefined;
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

    /*
     * Every channel below is sent only through this setting row, and the row
     * is read only while the person is a member of the project: somebody who
     * has left (or never accepted their invitation) reads as having nothing
     * set up, so a leftover row - an owner on a closed incident, a reference
     * a failed cleanup left behind - never reaches them. The membership check
     * rides on this read, so it costs no extra query (ProjectMembership).
     */
    const notificationSettings: UserNotificationSetting | null =
      await this.findOneBy({
        query: {
          userId: ProjectMembership.userIdWhileMember({
            userId: data.userId,
            projectId: data.projectId,
          }),
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
          alertByCustomChannel: true,
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

        /*
         * The SMS copy, in the characters an SMS carries cheaply and in one
         * part where it can be (NotificationSms), measured as the
         * Notification service sends it - with the installation's own name.
         * The Telegram, Slack and Microsoft Teams copies made from the same
         * text below keep every character as written.
         */
        const smsMessage: SMSMessage = {
          ...data.smsMessage,
          message: fitNotificationSmsForSending(
            data.smsMessage.message || "",
            (text: string): string => {
              return ProductBrandingText.brandText(text);
            },
          ),
        };

        for (const userSms of userSmses) {
          SmsService.sendSms(
            {
              ...smsMessage,
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
          lines.push(
            mdText`🔔 **${subject || "OneUptime notification"}**`.toString(),
          );
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
        if (data.securityCaseId) {
          webhookPayload["securityCaseId"] = data.securityCaseId.toString();
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

      if (notificationSettings.alertByCustomChannel) {
        logger.debug(
          `Sending custom channel notifications to user ${data.userId.toString()} for event ${data.eventType}`,
        );

        this.sendToCustomChannels({
          userId: data.userId,
          projectId: data.projectId,
          eventType: data.eventType,
          pushNotificationMessage: data.pushNotificationMessage,
        }).catch((err: Error) => {
          logger.error(err);
        });
      }
    }
  }

  /*
   * A notification through every custom channel that is on
   * (CustomNotificationChannel), for a person who turned custom channels on
   * for this setting (UserNotificationSetting.alertByCustomChannel): one
   * request per channel, naming them, as their on-call pages do. It says
   * what their push notification says - the short form every notification
   * has - and links where that links. Sent in the background, as every
   * other channel is: a channel that is down costs nothing but its own
   * request, and each outcome is in the server's log.
   */
  private async sendToCustomChannels(data: {
    userId: ObjectID;
    projectId: ObjectID;
    eventType: NotificationSettingEventType;
    pushNotificationMessage: PushNotificationMessage;
  }): Promise<void> {
    const channels: Array<CustomNotificationChannel> =
      await CustomNotificationChannelService.getChannelsThatAreOn();

    if (channels.length === 0) {
      return;
    }

    const [user, project]: [User | null, Project | null] = await Promise.all([
      UserService.findOneById({
        id: data.userId,
        select: {
          _id: true,
          name: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      }),
      ProjectService.findOneById({
        id: data.projectId,
        select: {
          _id: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
      }),
    ]);

    const message: PushNotificationMessage = data.pushNotificationMessage || {
      title: "",
      body: "",
    };

    const sendable: Array<CustomNotificationChannel> = channels.filter(
      (channel: CustomNotificationChannel): boolean => {
        return Boolean(channel.id);
      },
    );

    /*
     * Every channel at once, each on its own: one that is slow - a request
     * is tried again for half a minute - holds up no other, and one whose
     * send throws stops no other.
     */
    const results: Array<PromiseSettledResult<CustomChannelDeliveryResult>> =
      await Promise.allSettled(
        sendable.map(
          (
            channel: CustomNotificationChannel,
          ): Promise<CustomChannelDeliveryResult> => {
            return CustomNotificationChannelDeliveryService.send({
              customNotificationChannelId: channel.id!,
              eventType: CustomChannelEvent.Notification,
              // A project a master admin blocked sends nothing.
              projectId: data.projectId,
              payload: buildCustomChannelNotificationPayload({
                sentAt: OneUptimeDate.getCurrentDate(),
                channel: {
                  id: channel.id!.toString(),
                  name: channel.name || "",
                },
                notificationType: data.eventType,
                title: message.title || "",
                message: message.body || "",
                url: message.url || message.clickAction || undefined,
                project: {
                  id: data.projectId.toString(),
                  name: project?.name || "",
                },
                user: {
                  id: data.userId.toString(),
                  name: user?.name?.toString() || "",
                  email: user?.email?.toString() || "",
                },
              }),
            });
          },
        ),
      );

    results.forEach(
      (
        result: PromiseSettledResult<CustomChannelDeliveryResult>,
        index: number,
      ): void => {
        const channelId: string = sendable[index]?.id?.toString() || "";

        if (result.status === "rejected") {
          logger.warn(
            `Custom channel ${channelId}: a ${data.eventType} notification for user ${data.userId.toString()} could not be sent. ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          );
          return;
        }

        if (!result.value.ok) {
          logger.warn(
            `Custom channel ${channelId}: a ${data.eventType} notification for user ${data.userId.toString()} was not delivered. ${result.value.message}`,
          );
        }
      },
    );
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
    await this.addIncomingCallNotificationSettings(userId, projectId);
    await this.addSecurityCaseNotificationSettings(userId, projectId);
    await this.addSecurityHuntNotificationSettings(userId, projectId);
    await this.addExceptionNotificationSettings(userId, projectId);
  }

  /*
   * An exception assigned to the person, or to a team they are on
   * (ExceptionAssignmentNotifications), by email: as every owner-added
   * event, it is the person being handed something to look at. Idempotent -
   * the notification seeds it too before sending, for the members who
   * joined before it existed.
   */
  @CaptureSpan()
  public async addExceptionNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION,
    );
  }

  /*
   * A scheduled hunt that names the person, or a team they are on, finds
   * security events (SecurityHuntNotifications), by email and push: they
   * were named on the hunt to hear exactly this. Every member gets it, as
   * with every other event; only the people a hunt names are ever told.
   * Idempotent - the AddSecurityHuntNotificationSettingsForUsers data
   * migration calls this for every existing member, and the notifications
   * seed it too before sending.
   */
  @CaptureSpan()
  public async addSecurityHuntNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION,
      { alertByPush: true },
    );
  }

  /*
   * The security case events (SecurityCaseNotifications), by email and push:
   * a Critical case, a case handed to you, a containment step waiting for
   * your approval, a case about to miss a response target and a task handed
   * to you each need somebody now, and a phone is where they are seen
   * first. Every member gets them, as with every other event; only the
   * people who can read a case are ever told about it. Idempotent - the
   * AddSecurityCaseNotificationSettingsForUsers and
   * AddSecurityCaseTargetAndTaskNotificationSettingsForUsers data migrations
   * call this for every existing member, and the notifications seed it too
   * before sending.
   */
  @CaptureSpan()
  public async addSecurityCaseNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
      { alertByPush: true },
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
      { alertByPush: true },
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
      { alertByPush: true },
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_SECURITY_CASE_TARGET_NOTIFICATION,
      { alertByPush: true },
    );

    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_SECURITY_CASE_TASK_ASSIGNED_NOTIFICATION,
      { alertByPush: true },
    );
  }

  /*
   * Email on by default: a missed call is a customer who could not reach
   * anyone, and the owners are the people who can call them back.
   * Idempotent - the AddIncomingCallMissedNotificationSettingsForUsers data
   * migration calls this for every existing member, and the missed call
   * notification seeds it too before sending.
   */
  @CaptureSpan()
  public async addIncomingCallNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION,
    );
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

    /*
     * By email, as a new member starts "Incident created" too: what
     * addIncidentSlaBreachedNotificationSettings would give them.
     */
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION,
    );
  }

  /*
   * Gives a person their SLA breach setting when they have none (see
   * SLA_BREACH_CHANNELS for what it starts with); one they have is never
   * touched. Idempotent. A new member gets it by email with the other
   * incident events (addIncidentNotificationSettings); every existing
   * member gets it from the AddIncidentSlaBreachedNotificationSettingsForUsers
   * data migration, and CheckSlaBreaches makes sure of it before it sends -
   * sendUserNotification sends nothing for an event a person has no setting
   * for.
   */
  @CaptureSpan()
  public async addIncidentSlaBreachedNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    const existing: PositiveNumber = await this.countBy({
      query: {
        userId,
        projectId,
        eventType:
          NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION,
      },
      props: {
        isRoot: true,
      },
    });

    if (existing.toNumber() > 0) {
      return;
    }

    const incidentCreated: UserNotificationSetting | null =
      await this.findOneBy({
        query: {
          userId,
          projectId,
          eventType:
            NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
        },
        select: {
          alertByEmail: true,
          alertBySMS: true,
          alertByCall: true,
          alertByPush: true,
          alertByWhatsApp: true,
          alertByTelegram: true,
          alertBySlack: true,
          alertByMicrosoftTeams: true,
          alertByWebhook: true,
          alertByCustomChannel: true,
        },
        props: {
          isRoot: true,
        },
      });

    const item: UserNotificationSetting = new UserNotificationSetting();
    item.userId = userId;
    item.projectId = projectId;
    item.eventType =
      NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION;

    for (const channel of SLA_BREACH_CHANNELS) {
      if (incidentCreated?.[channel] === true) {
        item[channel] = true;
      }
    }

    item.alertByEmail = true;

    await this.create({
      data: item,
      props: {
        isRoot: true,
      },
    });
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

    await checkMinimumSecurityCasePriority({
      minimumSecurityCasePriorityId: RelationIdUtil.readIntoIdColumn(
        createBy.data as unknown as Record<string, unknown>,
        MINIMUM_PRIORITY_KEYS,
        "Minimum Security Case Priority",
      ),
      eventType: createBy.data.eventType,
      projectIds: createBy.data.projectId ? [createBy.data.projectId] : [],
    });

    return {
      createBy,
      carryForward: undefined,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<UserNotificationSetting>,
  ): Promise<OnUpdate<UserNotificationSetting>> {
    /*
     * The event a row is for is fixed (the matrix only switches channels),
     * so a priority choice is checked against the rows it lands on: the
     * rows the update writes, read the way every hook that judges an update
     * by its rows reads them (findRowsAndHoldUpdateToThem), with the update
     * held to them - so the rows checked are the rows written.
     */
    const minimumSecurityCasePriorityId: ObjectID | null =
      RelationIdUtil.readIntoIdColumn(
        updateBy.data as unknown as Record<string, unknown>,
        MINIMUM_PRIORITY_KEYS,
        "Minimum Security Case Priority",
      );

    if (minimumSecurityCasePriorityId) {
      const rows: Array<UserNotificationSetting> =
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          eventType: true,
          projectId: true,
        });

      await checkMinimumSecurityCasePriority({
        minimumSecurityCasePriorityId,
        eventType: undefined,
        projectIds: rows
          .map((row: UserNotificationSetting): ObjectID | undefined => {
            return row.projectId;
          })
          .filter((id: ObjectID | undefined): id is ObjectID => {
            return Boolean(id);
          }),
      });

      const isAnotherEventsRow: boolean = rows.some(
        (row: UserNotificationSetting): boolean => {
          return (
            row.eventType !==
            NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION
          );
        },
      );

      if (isAnotherEventsRow) {
        throw new BadDataException(
          "Only the New Security Case setting has a priority to choose.",
        );
      }
    }

    return {
      updateBy,
      carryForward: null,
    };
  }
}

export default new Service();
