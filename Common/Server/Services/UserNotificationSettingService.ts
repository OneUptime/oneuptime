import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import logger from "../Utils/Logger";
import CallService from "./CallService";
import DatabaseService from "./DatabaseService";
import MailService from "./MailService";
import SmsService from "./SmsService";
import TeamMemberService from "./TeamMemberService";
import TelegramService from "./TelegramService";
import UserCallService from "./UserCallService";
import UserEmailService from "./UserEmailService";
import UserSmsService from "./UserSmsService";
import PushNotificationService from "./PushNotificationService";
import UserTelegramService from "./UserTelegramService";
import UserWhatsAppService from "./UserWhatsAppService";
import WhatsAppService from "./WhatsAppService";
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
import WhatsAppMessage, {
  WhatsAppMessagePayload,
} from "../../Types/WhatsApp/WhatsAppMessage";
import UserCall from "../../Models/DatabaseModels/UserCall";
import UserEmail from "../../Models/DatabaseModels/UserEmail";
import UserNotificationSetting from "../../Models/DatabaseModels/UserNotificationSetting";
import UserSMS from "../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../Models/DatabaseModels/UserTelegram";
import UserWhatsApp from "../../Models/DatabaseModels/UserWhatsApp";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { appendRecipientToWhatsAppMessage } from "../Utils/WhatsAppTemplateUtil";

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
    whatsAppMessage: WhatsAppMessagePayload;
    telegramMessage?: TelegramMessagePayload | undefined;
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
          alertByCall: true,
          alertByPush: true,
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

        for (const userEmail of userEmails) {
          MailService.sendMail(
            {
              ...data.emailEnvelope,
              toEmail: userEmail.email!,
            },
            {
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
          ).catch((err: Error) => {
            logger.error(err);
          });
        }
      }

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
  }

  private async addMonitorNotificationSettings(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await this.addNotificationSettingIfNotExists(
      userId,
      projectId,
      NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION,
    );

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
  }

  private async addNotificationSettingIfNotExists(
    userId: ObjectID,
    projectId: ObjectID,
    eventType: NotificationSettingEventType,
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
