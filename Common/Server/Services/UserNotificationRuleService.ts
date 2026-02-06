import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import Markdown, { MarkdownContentType } from "../Types/Markdown";
import CallService from "./CallService";
import DatabaseService from "./DatabaseService";
import IncidentService from "./IncidentService";
import IncidentSeverityService from "./IncidentSeverityService";
import MailService from "./MailService";
import ShortLinkService from "./ShortLinkService";
import SmsService from "./SmsService";
import WhatsAppService from "./WhatsAppService";
import UserEmailService from "./UserEmailService";
import UserOnCallLogService from "./UserOnCallLogService";
import UserOnCallLogTimelineService from "./UserOnCallLogTimelineService";
import { AppApiRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import CallRequest from "../../Types/Call/CallRequest";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import EmailMessage from "../../Types/Email/EmailMessage";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../Types/ObjectID";
import Phone from "../../Types/Phone";
import SMS from "../../Types/SMS/SMS";
import WhatsAppMessage from "../../Types/WhatsApp/WhatsAppMessage";
import {
  renderWhatsAppTemplate,
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
  WhatsAppTemplateId,
} from "../../Types/WhatsApp/WhatsAppTemplates";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "../../Types/UserNotification/UserNotificationStatus";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import ShortLink from "../../Models/DatabaseModels/ShortLink";
import UserEmail from "../../Models/DatabaseModels/UserEmail";
import Model from "../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertService from "./AlertService";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import AlertSeverityService from "./AlertSeverityService";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeService from "./AlertEpisodeService";
import AlertEpisodeMember from "../../Models/DatabaseModels/AlertEpisodeMember";
import AlertEpisodeMemberService from "./AlertEpisodeMemberService";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeService from "./IncidentEpisodeService";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import PushNotificationService from "./PushNotificationService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async executeNotificationRuleItem(
    userNotificationRuleId: ObjectID,
    options: {
      projectId: ObjectID;
      triggeredByIncidentId?: ObjectID | undefined;
      triggeredByAlertId?: ObjectID | undefined;
      triggeredByAlertEpisodeId?: ObjectID | undefined;
      triggeredByIncidentEpisodeId?: ObjectID | undefined;
      userNotificationEventType: UserNotificationEventType;
      onCallPolicyExecutionLogId?: ObjectID | undefined;
      onCallPolicyId: ObjectID | undefined;
      onCallPolicyEscalationRuleId?: ObjectID | undefined;
      userNotificationLogId: ObjectID;
      userBelongsToTeamId?: ObjectID | undefined;
      onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
    },
  ): Promise<void> {
    // get user notification log and see if this rule has already been executed. If so then skip.

    const userOnCallLog: UserOnCallLog | null =
      await UserOnCallLogService.findOneById({
        id: options.userNotificationLogId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          executedNotificationRules: true,
        },
      });

    if (!userOnCallLog) {
      throw new BadDataException("User notification log not found.");
    }

    if (
      Object.keys(userOnCallLog.executedNotificationRules || {}).includes(
        userNotificationRuleId.toString(),
      )
    ) {
      // already executed.
      return;
    }

    if (!userOnCallLog.executedNotificationRules) {
      userOnCallLog.executedNotificationRules = {};
    }

    userOnCallLog.executedNotificationRules[userNotificationRuleId.toString()] =
      OneUptimeDate.getCurrentDate();

    await UserOnCallLogService.updateOneById({
      id: userOnCallLog.id!,
      data: {
        executedNotificationRules: {
          ...userOnCallLog.executedNotificationRules,
        },
      } as any,
      props: {
        isRoot: true,
      },
    });

    // find notification rule item.
    const notificationRuleItem: Model | null = await this.findOneById({
      id: userNotificationRuleId!,
      select: {
        _id: true,
        userId: true,
        userCall: {
          phone: true,
          isVerified: true,
        },
        userSms: {
          phone: true,
          isVerified: true,
        },
        userWhatsApp: {
          phone: true,
          isVerified: true,
        },
        userEmail: {
          email: true,
          isVerified: true,
        },
        userPush: {
          deviceToken: true,
          deviceType: true,
          isVerified: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!notificationRuleItem) {
      throw new BadDataException("Notification rule item not found.");
    }

    const logTimelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    logTimelineItem.projectId = options.projectId;
    logTimelineItem.userNotificationLogId = options.userNotificationLogId;
    logTimelineItem.userNotificationRuleId = userNotificationRuleId;
    logTimelineItem.userNotificationLogId = options.userNotificationLogId;
    logTimelineItem.userId = notificationRuleItem.userId!;
    logTimelineItem.userNotificationEventType =
      options.userNotificationEventType;

    if (options.userBelongsToTeamId) {
      logTimelineItem.userBelongsToTeamId = options.userBelongsToTeamId;
    }

    if (options.onCallPolicyId) {
      logTimelineItem.onCallDutyPolicyId = options.onCallPolicyId;
    }

    if (options.onCallPolicyEscalationRuleId) {
      logTimelineItem.onCallDutyPolicyEscalationRuleId =
        options.onCallPolicyEscalationRuleId;
    }

    if (options.onCallPolicyExecutionLogId) {
      logTimelineItem.onCallDutyPolicyExecutionLogId =
        options.onCallPolicyExecutionLogId;
    }

    if (options.triggeredByIncidentId) {
      logTimelineItem.triggeredByIncidentId = options.triggeredByIncidentId;
    }

    if (options.triggeredByAlertId) {
      logTimelineItem.triggeredByAlertId = options.triggeredByAlertId;
    }

    if (options.triggeredByAlertEpisodeId) {
      logTimelineItem.triggeredByAlertEpisodeId =
        options.triggeredByAlertEpisodeId;
    }

    if (options.triggeredByIncidentEpisodeId) {
      logTimelineItem.triggeredByIncidentEpisodeId =
        options.triggeredByIncidentEpisodeId;
    }

    if (options.onCallDutyPolicyExecutionLogTimelineId) {
      logTimelineItem.onCallDutyPolicyExecutionLogTimelineId =
        options.onCallDutyPolicyExecutionLogTimelineId;
    }

    // add status and status message and save.

    let incident: Incident | null = null;
    let alert: Alert | null = null;
    let alertEpisode: AlertEpisode | null = null;

    if (
      options.userNotificationEventType ===
        UserNotificationEventType.IncidentCreated &&
      options.triggeredByIncidentId
    ) {
      incident = await IncidentService.findOneById({
        id: options.triggeredByIncidentId!,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          project: {
            name: true,
          },
          currentIncidentState: {
            name: true,
          },
          incidentSeverity: {
            name: true,
          },
          rootCause: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        },
      });
    }

    if (
      options.userNotificationEventType ===
        UserNotificationEventType.AlertCreated &&
      options.triggeredByAlertId
    ) {
      alert = await AlertService.findOneById({
        id: options.triggeredByAlertId!,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          project: {
            name: true,
          },
          currentAlertState: {
            name: true,
          },
          alertSeverity: {
            name: true,
          },
          alertNumber: true,
        },
      });
    }

    if (
      options.userNotificationEventType ===
        UserNotificationEventType.AlertEpisodeCreated &&
      options.triggeredByAlertEpisodeId
    ) {
      alertEpisode = await AlertEpisodeService.findOneById({
        id: options.triggeredByAlertEpisodeId!,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          project: {
            name: true,
          },
          currentAlertState: {
            name: true,
          },
          alertSeverity: {
            name: true,
          },
          episodeNumber: true,
          episodeNumberWithPrefix: true,
          rootCause: true,
        },
      });
    }

    let incidentEpisode: IncidentEpisode | null = null;

    if (
      options.userNotificationEventType ===
        UserNotificationEventType.IncidentEpisodeCreated &&
      options.triggeredByIncidentEpisodeId
    ) {
      incidentEpisode = await IncidentEpisodeService.findOneById({
        id: options.triggeredByIncidentEpisodeId!,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          project: {
            name: true,
          },
          currentIncidentState: {
            name: true,
          },
          incidentSeverity: {
            name: true,
          },
          episodeNumber: true,
          episodeNumberWithPrefix: true,
          rootCause: true,
        },
      });
    }

    if (!incident && !alert && !alertEpisode && !incidentEpisode) {
      throw new BadDataException(
        "Incident, Alert, Alert Episode, or Incident Episode not found.",
      );
    }

    if (
      notificationRuleItem.userEmail?.email &&
      notificationRuleItem.userEmail?.isVerified
    ) {
      // send email for alert.

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        // create an error log.
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending email to ${notificationRuleItem.userEmail?.email.toString()}`;
        logTimelineItem.userEmailId = notificationRuleItem.userEmail.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const emailMessage: EmailMessage =
          await this.generateEmailTemplateForAlertCreated(
            notificationRuleItem.userEmail?.email,
            alert,
            updatedLog.id!,
          );

        // send email.

        MailService.sendMail(emailMessage, {
          userOnCallLogTimelineId: updatedLog.id!,
          projectId: options.projectId,
          alertId: alert.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending email.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send email for incident
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        // create an error log.
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending email to ${notificationRuleItem.userEmail?.email.toString()}`;
        logTimelineItem.userEmailId = notificationRuleItem.userEmail.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const emailMessage: EmailMessage =
          await this.generateEmailTemplateForIncidentCreated(
            notificationRuleItem.userEmail?.email,
            incident,
            updatedLog.id!,
          );

        // send email.

        MailService.sendMail(emailMessage, {
          userOnCallLogTimelineId: updatedLog.id!,
          projectId: options.projectId,
          incidentId: incident.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending email.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send email for alert episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending email to ${notificationRuleItem.userEmail?.email.toString()}`;
        logTimelineItem.userEmailId = notificationRuleItem.userEmail.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const emailMessage: EmailMessage =
          await this.generateEmailTemplateForAlertEpisodeCreated(
            notificationRuleItem.userEmail?.email,
            alertEpisode,
            updatedLog.id!,
          );

        MailService.sendMail(emailMessage, {
          userOnCallLogTimelineId: updatedLog.id!,
          projectId: options.projectId,
          alertEpisodeId: alertEpisode.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending email.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }
    }

    // if you have an email but is not verified, then create a log.
    if (
      notificationRuleItem.userEmail?.email &&
      !notificationRuleItem.userEmail?.isVerified
    ) {
      // create an error log.
      logTimelineItem.status = UserNotificationStatus.Error;
      logTimelineItem.statusMessage = `Email notification not sent because email ${notificationRuleItem.userEmail?.email.toString()} is not verified.`;

      await UserOnCallLogTimelineService.create({
        data: logTimelineItem,
        props: {
          isRoot: true,
        },
      });
    }

    // send sms.
    if (
      notificationRuleItem.userSms?.phone &&
      notificationRuleItem.userSms?.isVerified
    ) {
      //send sms for alert
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        // create an error log.
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending SMS to ${notificationRuleItem.userSms?.phone.toString()}.`;
        logTimelineItem.userSmsId = notificationRuleItem.userSms.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const smsMessage: SMS = await this.generateSmsTemplateForAlertCreated(
          notificationRuleItem.userSms.phone,
          alert,
          updatedLog.id!,
        );

        // send sms.

        SmsService.sendSms(smsMessage, {
          projectId: alert.projectId,
          userOnCallLogTimelineId: updatedLog.id!,
          alertId: alert.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending SMS.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send sms for incident
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        // create an error log.
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending SMS to ${notificationRuleItem.userSms?.phone.toString()}.`;
        logTimelineItem.userSmsId = notificationRuleItem.userSms.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const smsMessage: SMS =
          await this.generateSmsTemplateForIncidentCreated(
            notificationRuleItem.userSms.phone,
            incident,
            updatedLog.id!,
          );

        // send sms.

        SmsService.sendSms(smsMessage, {
          projectId: incident.projectId,
          userOnCallLogTimelineId: updatedLog.id!,
          incidentId: incident.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending SMS.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send sms for alert episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending SMS to ${notificationRuleItem.userSms?.phone.toString()}.`;
        logTimelineItem.userSmsId = notificationRuleItem.userSms.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const smsMessage: SMS =
          await this.generateSmsTemplateForAlertEpisodeCreated(
            notificationRuleItem.userSms.phone,
            alertEpisode,
            updatedLog.id!,
          );

        SmsService.sendSms(smsMessage, {
          projectId: alertEpisode.projectId,
          userOnCallLogTimelineId: updatedLog.id!,
          alertEpisodeId: alertEpisode.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending SMS.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }
    }

    if (
      notificationRuleItem.userSms?.phone &&
      !notificationRuleItem.userSms?.isVerified
    ) {
      // create a log.
      logTimelineItem.status = UserNotificationStatus.Error;
      logTimelineItem.statusMessage = `SMS not sent because phone ${notificationRuleItem.userSms?.phone.toString()} is not verified.`;

      await UserOnCallLogTimelineService.create({
        data: logTimelineItem,
        props: {
          isRoot: true,
        },
      });
    }

    if (
      notificationRuleItem.userWhatsApp?.phone &&
      notificationRuleItem.userWhatsApp?.isVerified
    ) {
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending WhatsApp message to ${notificationRuleItem.userWhatsApp?.phone.toString()}.`;
        logTimelineItem.userWhatsAppId = notificationRuleItem.userWhatsApp.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const whatsAppMessage: WhatsAppMessage =
          await this.generateWhatsAppTemplateForAlertCreated(
            notificationRuleItem.userWhatsApp.phone,
            alert,
            updatedLog.id!,
          );

        WhatsAppService.sendWhatsAppMessage(whatsAppMessage, {
          projectId: alert.projectId,
          alertId: alert.id!,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending WhatsApp message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending WhatsApp message to ${notificationRuleItem.userWhatsApp?.phone.toString()}.`;
        logTimelineItem.userWhatsAppId = notificationRuleItem.userWhatsApp.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const whatsAppMessage: WhatsAppMessage =
          await this.generateWhatsAppTemplateForIncidentCreated(
            notificationRuleItem.userWhatsApp.phone,
            incident,
            updatedLog.id!,
          );

        WhatsAppService.sendWhatsAppMessage(whatsAppMessage, {
          projectId: incident.projectId,
          incidentId: incident.id!,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending WhatsApp message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send WhatsApp for alert episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending WhatsApp message to ${notificationRuleItem.userWhatsApp?.phone.toString()}.`;
        logTimelineItem.userWhatsAppId = notificationRuleItem.userWhatsApp.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const whatsAppMessage: WhatsAppMessage =
          await this.generateWhatsAppTemplateForAlertEpisodeCreated(
            notificationRuleItem.userWhatsApp.phone,
            alertEpisode,
            updatedLog.id!,
          );

        WhatsAppService.sendWhatsAppMessage(whatsAppMessage, {
          projectId: alertEpisode.projectId,
          alertEpisodeId: alertEpisode.id!,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending WhatsApp message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }
    }

    if (
      notificationRuleItem.userWhatsApp?.phone &&
      !notificationRuleItem.userWhatsApp?.isVerified
    ) {
      logTimelineItem.status = UserNotificationStatus.Error;
      logTimelineItem.statusMessage = `WhatsApp message not sent because phone ${notificationRuleItem.userWhatsApp?.phone.toString()} is not verified.`;
      logTimelineItem.userWhatsAppId = notificationRuleItem.userWhatsApp.id!;

      await UserOnCallLogTimelineService.create({
        data: logTimelineItem,
        props: {
          isRoot: true,
        },
      });
    }

    // send call.
    if (
      notificationRuleItem.userCall?.phone &&
      notificationRuleItem.userCall?.isVerified
    ) {
      // send call for alert
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        // create an error log.
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Making a call to ${notificationRuleItem.userCall?.phone.toString()}.`;
        logTimelineItem.userCallId = notificationRuleItem.userCall.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const callRequest: CallRequest =
          await this.generateCallTemplateForAlertCreated(
            notificationRuleItem.userCall?.phone,
            alert,
            updatedLog.id!,
          );

        // send call.

        CallService.makeCall(callRequest, {
          projectId: alert.projectId,
          userOnCallLogTimelineId: updatedLog.id!,
          alertId: alert.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error making call.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        // send call for incident
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Making a call to ${notificationRuleItem.userCall?.phone.toString()}.`;
        logTimelineItem.userCallId = notificationRuleItem.userCall.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const callRequest: CallRequest =
          await this.generateCallTemplateForIncidentCreated(
            notificationRuleItem.userCall?.phone,
            incident,
            updatedLog.id!,
          );

        // send call.

        CallService.makeCall(callRequest, {
          projectId: incident.projectId,
          userOnCallLogTimelineId: updatedLog.id!,
          incidentId: incident.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error making call.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send call for alert episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Making a call to ${notificationRuleItem.userCall?.phone.toString()}.`;
        logTimelineItem.userCallId = notificationRuleItem.userCall.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const callRequest: CallRequest =
          await this.generateCallTemplateForAlertEpisodeCreated(
            notificationRuleItem.userCall?.phone,
            alertEpisode,
            updatedLog.id!,
          );

        CallService.makeCall(callRequest, {
          projectId: alertEpisode.projectId,
          userOnCallLogTimelineId: updatedLog.id!,
          alertEpisodeId: alertEpisode.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error making call.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }
    }

    if (
      notificationRuleItem.userCall?.phone &&
      !notificationRuleItem.userCall?.isVerified
    ) {
      // create a log.
      logTimelineItem.status = UserNotificationStatus.Error;
      logTimelineItem.statusMessage = `Call not sent because phone ${notificationRuleItem.userCall?.phone.toString()} is not verified.`;

      await UserOnCallLogTimelineService.create({
        data: logTimelineItem,
        props: {
          isRoot: true,
        },
      });
    }

    // send push notification.
    if (
      notificationRuleItem.userPush?.deviceToken &&
      notificationRuleItem.userPush?.isVerified
    ) {
      // send push notification for alert
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        // create a log.
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending push notification to device.`;
        logTimelineItem.userPushId = notificationRuleItem.userPush.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createAlertCreatedNotification({
            alertTitle: alert.title!,
            projectName: alert.project?.name || "OneUptime",
            alertViewLink: (
              await AlertService.getAlertLinkInDashboard(
                alert.projectId!,
                alert.id!,
              )
            ).toString(),
            ...(alert.alertNumber !== undefined && {
              alertNumber: alert.alertNumber,
            }),
          });

        // send push notification.
        PushNotificationService.sendPushNotification(
          {
            devices: [
              {
                token: notificationRuleItem.userPush.deviceToken!,
                ...(notificationRuleItem.userPush.deviceName && {
                  name: notificationRuleItem.userPush.deviceName,
                }),
              },
            ],
            message: pushMessage,
            deviceType: notificationRuleItem.userPush.deviceType!,
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: updatedLog.id!,
            alertId: alert.id!,
            userId: notificationRuleItem.userId!,
            onCallPolicyId: options.onCallPolicyId,
            onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
            teamId: options.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              options.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: options.onCallScheduleId,
          },
        ).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending push notification.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send push notification for incident
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        // create a log.
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending push notification to device.`;
        logTimelineItem.userPushId = notificationRuleItem.userPush.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createIncidentCreatedNotification({
            incidentTitle: incident.title!,
            projectName: incident.project?.name || "OneUptime",
            incidentViewLink: (
              await IncidentService.getIncidentLinkInDashboard(
                incident.projectId!,
                incident.id!,
              )
            ).toString(),
            ...(incident.incidentNumber !== undefined && {
              incidentNumber: incident.incidentNumber,
            }),
          });

        // send push notification.
        PushNotificationService.sendPushNotification(
          {
            devices: [
              {
                token: notificationRuleItem.userPush.deviceToken!,
                ...(notificationRuleItem.userPush.deviceName && {
                  name: notificationRuleItem.userPush.deviceName,
                }),
              },
            ],
            message: pushMessage,
            deviceType: notificationRuleItem.userPush.deviceType!,
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: updatedLog.id!,
            incidentId: incident.id!,
            userId: notificationRuleItem.userId!,
            onCallPolicyId: options.onCallPolicyId,
            onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
            teamId: options.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              options.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: options.onCallScheduleId,
          },
        ).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending push notification.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send push notification for alert episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending push notification to device.`;
        logTimelineItem.userPushId = notificationRuleItem.userPush.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createAlertEpisodeCreatedNotification({
            alertEpisodeTitle: alertEpisode.title!,
            projectName: alertEpisode.project?.name || "OneUptime",
            alertEpisodeViewLink: (
              await AlertEpisodeService.getEpisodeLinkInDashboard(
                alertEpisode.projectId!,
                alertEpisode.id!,
              )
            ).toString(),
            ...(alertEpisode.episodeNumber !== undefined && {
              episodeNumber: alertEpisode.episodeNumber,
            }),
            ...(alertEpisode.episodeNumberWithPrefix && {
              episodeNumberWithPrefix: alertEpisode.episodeNumberWithPrefix,
            }),
          });

        PushNotificationService.sendPushNotification(
          {
            devices: [
              {
                token: notificationRuleItem.userPush.deviceToken!,
                ...(notificationRuleItem.userPush.deviceName && {
                  name: notificationRuleItem.userPush.deviceName,
                }),
              },
            ],
            message: pushMessage,
            deviceType: notificationRuleItem.userPush.deviceType!,
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: updatedLog.id!,
            alertEpisodeId: alertEpisode.id!,
            userId: notificationRuleItem.userId!,
            onCallPolicyId: options.onCallPolicyId,
            onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
            teamId: options.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              options.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: options.onCallScheduleId,
          },
        ).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending push notification.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }
    }

    if (
      notificationRuleItem.userPush?.deviceToken &&
      !notificationRuleItem.userPush?.isVerified
    ) {
      // create a log.
      logTimelineItem.status = UserNotificationStatus.Error;
      logTimelineItem.statusMessage = `Push notification not sent because device is not verified.`;

      await UserOnCallLogTimelineService.create({
        data: logTimelineItem,
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public async generateCallTemplateForAlertCreated(
    to: Phone,
    alert: Alert,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<CallRequest> {
    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const alertIdentifier: string =
      alert.alertNumber !== undefined
        ? `Alert number ${alert.alertNumber}, ${alert.title || "Alert"}`
        : alert.title || "Alert";

    const callRequest: CallRequest = {
      to: to,
      data: [
        {
          sayMessage: "This is a call from OneUptime",
        },
        {
          sayMessage: "A new alert has been created",
        },
        {
          sayMessage: alertIdentifier,
        },
        {
          introMessage: "To acknowledge this alert press 1",
          numDigits: 1,
          timeoutInSeconds: 10,
          noInputMessage: "You have not entered any input. Good bye",
          onInputCallRequest: {
            "1": {
              sayMessage: "You have acknowledged this alert. Good bye",
            },
            default: {
              sayMessage: "Invalid input. Good bye",
            },
          },
          responseUrl: new URL(
            httpProtocol,
            host,
            new Route(AppApiRoute.toString())
              .addRoute(new UserOnCallLogTimeline().crudApiPath!)
              .addRoute(
                "/call/gather-input/" + userOnCallLogTimelineId.toString(),
              ),
          ),
        },
      ],
    };

    return callRequest;
  }

  @CaptureSpan()
  public async generateCallTemplateForIncidentCreated(
    to: Phone,
    incident: Incident,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<CallRequest> {
    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const incidentIdentifier: string =
      incident.incidentNumber !== undefined
        ? `Incident number ${incident.incidentNumberWithPrefix || incident.incidentNumber}, ${incident.title || "Incident"}`
        : incident.title || "Incident";

    const callRequest: CallRequest = {
      to: to,
      data: [
        {
          sayMessage: "This is a call from OneUptime",
        },
        {
          sayMessage: "A new incident has been created",
        },
        {
          sayMessage: incidentIdentifier,
        },
        {
          introMessage: "To acknowledge this incident press 1",
          numDigits: 1,
          timeoutInSeconds: 10,
          noInputMessage: "You have not entered any input. Good bye",
          onInputCallRequest: {
            "1": {
              sayMessage: "You have acknowledged this incident. Good bye",
            },
            default: {
              sayMessage: "Invalid input. Good bye",
            },
          },
          responseUrl: new URL(
            httpProtocol,
            host,
            new Route(AppApiRoute.toString())
              .addRoute(new UserOnCallLogTimeline().crudApiPath!)
              .addRoute(
                "/call/gather-input/" + userOnCallLogTimelineId.toString(),
              ),
          ),
        },
      ],
    };

    return callRequest;
  }

  @CaptureSpan()
  public async generateCallTemplateForAlertEpisodeCreated(
    to: Phone,
    alertEpisode: AlertEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<CallRequest> {
    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const episodeIdentifier: string =
      alertEpisode.episodeNumberWithPrefix
        ? `Alert episode ${alertEpisode.episodeNumberWithPrefix}, ${alertEpisode.title || "Alert Episode"}`
        : alertEpisode.episodeNumber !== undefined
          ? `Alert episode number ${alertEpisode.episodeNumber}, ${alertEpisode.title || "Alert Episode"}`
          : alertEpisode.title || "Alert Episode";

    const callRequest: CallRequest = {
      to: to,
      data: [
        {
          sayMessage: "This is a call from OneUptime",
        },
        {
          sayMessage: "A new alert episode has been created",
        },
        {
          sayMessage: episodeIdentifier,
        },
        {
          introMessage: "To acknowledge this alert episode press 1",
          numDigits: 1,
          timeoutInSeconds: 10,
          noInputMessage: "You have not entered any input. Good bye",
          onInputCallRequest: {
            "1": {
              sayMessage: "You have acknowledged this alert episode. Good bye",
            },
            default: {
              sayMessage: "Invalid input. Good bye",
            },
          },
          responseUrl: new URL(
            httpProtocol,
            host,
            new Route(AppApiRoute.toString())
              .addRoute(new UserOnCallLogTimeline().crudApiPath!)
              .addRoute(
                "/call/gather-input/" + userOnCallLogTimelineId.toString(),
              ),
          ),
        },
      ],
    };

    return callRequest;
  }

  @CaptureSpan()
  public async generateSmsTemplateForAlertCreated(
    to: Phone,
    alert: Alert,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<SMS> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const shortUrl: ShortLink = await ShortLinkService.saveShortLinkFor(
      new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ),
    );
    const url: URL = await ShortLinkService.getShortenedUrl(shortUrl);

    const alertIdentifier: string =
      alert.alertNumber !== undefined
        ? `#${alert.alertNumber} (${alert.title || "Alert"})`
        : alert.title || "Alert";

    const sms: SMS = {
      to,
      message: `This is a message from OneUptime. A new alert has been created: ${alertIdentifier}. To acknowledge this alert, please click on the following link ${url.toString()}`,
    };

    return sms;
  }

  @CaptureSpan()
  public async generateSmsTemplateForIncidentCreated(
    to: Phone,
    incident: Incident,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<SMS> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const shortUrl: ShortLink = await ShortLinkService.saveShortLinkFor(
      new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ),
    );
    const url: URL = await ShortLinkService.getShortenedUrl(shortUrl);

    const incidentIdentifier: string =
      incident.incidentNumber !== undefined
        ? `${incident.incidentNumberWithPrefix || '#' + incident.incidentNumber} (${incident.title || "Incident"})`
        : incident.title || "Incident";

    const sms: SMS = {
      to,
      message: `This is a message from OneUptime. A new incident has been created: ${incidentIdentifier}. To acknowledge this incident, please click on the following link ${url.toString()}`,
    };

    return sms;
  }

  @CaptureSpan()
  public async generateSmsTemplateForAlertEpisodeCreated(
    to: Phone,
    alertEpisode: AlertEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<SMS> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const shortUrl: ShortLink = await ShortLinkService.saveShortLinkFor(
      new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ),
    );
    const url: URL = await ShortLinkService.getShortenedUrl(shortUrl);

    const episodeIdentifier: string =
      alertEpisode.episodeNumberWithPrefix
        ? `${alertEpisode.episodeNumberWithPrefix} (${alertEpisode.title || "Alert Episode"})`
        : alertEpisode.episodeNumber !== undefined
          ? `#${alertEpisode.episodeNumber} (${alertEpisode.title || "Alert Episode"})`
          : alertEpisode.title || "Alert Episode";

    const sms: SMS = {
      to,
      message: `This is a message from OneUptime. A new alert episode has been created: ${episodeIdentifier}. To acknowledge this alert episode, please click on the following link ${url.toString()}`,
    };

    return sms;
  }

  @CaptureSpan()
  public async generateWhatsAppTemplateForAlertCreated(
    to: Phone,
    alert: Alert,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<WhatsAppMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const acknowledgeShortLink: ShortLink =
      await ShortLinkService.saveShortLinkFor(
        new URL(
          httpProtocol,
          host,
          new Route(AppApiRoute.toString())
            .addRoute(new UserOnCallLogTimeline().crudApiPath!)
            .addRoute(
              "/acknowledge-page/" + userOnCallLogTimelineId.toString(),
            ),
        ),
      );

    const acknowledgeUrl: URL =
      await ShortLinkService.getShortenedUrl(acknowledgeShortLink);

    const alertLinkOnDashboard: string =
      alert.projectId && alert.id
        ? (
            await AlertService.getAlertLinkInDashboard(
              alert.projectId,
              alert.id,
            )
          ).toString()
        : acknowledgeUrl.toString();

    const templateKey: WhatsAppTemplateId = WhatsAppTemplateIds.AlertCreated;
    const templateVariables: Record<string, string> = {
      project_name: alert.project?.name || "OneUptime",
      alert_title: alert.title || "",
      acknowledge_url: acknowledgeUrl.toString(),
      alert_number:
        alert.alertNumber !== undefined ? alert.alertNumber.toString() : "",
      alert_link: alertLinkOnDashboard,
    };

    const body: string = renderWhatsAppTemplate(templateKey, templateVariables);

    return {
      to,
      body,
      templateKey,
      templateVariables,
      templateLanguageCode: WhatsAppTemplateLanguage[templateKey],
    };
  }

  @CaptureSpan()
  public async generateWhatsAppTemplateForIncidentCreated(
    to: Phone,
    incident: Incident,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<WhatsAppMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const acknowledgeShortLink: ShortLink =
      await ShortLinkService.saveShortLinkFor(
        new URL(
          httpProtocol,
          host,
          new Route(AppApiRoute.toString())
            .addRoute(new UserOnCallLogTimeline().crudApiPath!)
            .addRoute(
              "/acknowledge-page/" + userOnCallLogTimelineId.toString(),
            ),
        ),
      );

    const acknowledgeUrl: URL =
      await ShortLinkService.getShortenedUrl(acknowledgeShortLink);

    const incidentLinkOnDashboard: string =
      incident.projectId && incident.id
        ? (
            await IncidentService.getIncidentLinkInDashboard(
              incident.projectId,
              incident.id,
            )
          ).toString()
        : acknowledgeUrl.toString();

    const templateKey: WhatsAppTemplateId = WhatsAppTemplateIds.IncidentCreated;
    const templateVariables: Record<string, string> = {
      project_name: incident.project?.name || "OneUptime",
      incident_title: incident.title || "",
      acknowledge_url: acknowledgeUrl.toString(),
      incident_number:
        incident.incidentNumber !== undefined
          ? incident.incidentNumber.toString()
          : "",
      incident_link: incidentLinkOnDashboard,
    };

    const body: string = renderWhatsAppTemplate(templateKey, templateVariables);

    return {
      to,
      body,
      templateKey,
      templateVariables,
      templateLanguageCode: WhatsAppTemplateLanguage[templateKey],
    };
  }

  @CaptureSpan()
  public async generateWhatsAppTemplateForAlertEpisodeCreated(
    to: Phone,
    alertEpisode: AlertEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<WhatsAppMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const acknowledgeShortLink: ShortLink =
      await ShortLinkService.saveShortLinkFor(
        new URL(
          httpProtocol,
          host,
          new Route(AppApiRoute.toString())
            .addRoute(new UserOnCallLogTimeline().crudApiPath!)
            .addRoute(
              "/acknowledge-page/" + userOnCallLogTimelineId.toString(),
            ),
        ),
      );

    const acknowledgeUrl: URL =
      await ShortLinkService.getShortenedUrl(acknowledgeShortLink);

    const episodeLinkOnDashboard: string =
      alertEpisode.projectId && alertEpisode.id
        ? (
            await AlertEpisodeService.getEpisodeLinkInDashboard(
              alertEpisode.projectId,
              alertEpisode.id,
            )
          ).toString()
        : acknowledgeUrl.toString();

    const templateKey: WhatsAppTemplateId =
      WhatsAppTemplateIds.AlertEpisodeCreated;
    const templateVariables: Record<string, string> = {
      project_name: alertEpisode.project?.name || "OneUptime",
      episode_title: alertEpisode.title || "",
      acknowledge_url: acknowledgeUrl.toString(),
      episode_number:
        alertEpisode.episodeNumberWithPrefix ||
        (alertEpisode.episodeNumber !== undefined
          ? alertEpisode.episodeNumber.toString()
          : ""),
      episode_link: episodeLinkOnDashboard,
    };

    const body: string = renderWhatsAppTemplate(templateKey, templateVariables);

    return {
      to,
      body,
      templateKey,
      templateVariables,
      templateLanguageCode: WhatsAppTemplateLanguage[templateKey],
    };
  }

  @CaptureSpan()
  public async generateEmailTemplateForAlertCreated(
    to: Email,
    alert: Alert,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<EmailMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const alertNumber: string = alert.alertNumber
      ? `#${alert.alertNumber}`
      : "";

    const vars: Dictionary<string> = {
      alertTitle: alert.title!,
      alertNumber: alertNumber,
      projectName: alert.project!.name!,
      currentState: alert.currentAlertState!.name!,
      alertDescription: await Markdown.convertToHTML(
        alert.description! || "",
        MarkdownContentType.Email,
      ),
      alertSeverity: alert.alertSeverity!.name!,
      alertViewLink: (
        await AlertService.getAlertLinkInDashboard(alert.projectId!, alert.id!)
      ).toString(),
      acknowledgeAlertLink: new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ).toString(),
    };

    const emailMessage: EmailMessage = {
      toEmail: to!,
      templateType: EmailTemplateType.AcknowledgeAlert,
      vars: vars,
      subject: `ACTION REQUIRED: Alert ${alertNumber} created - ${alert.title!}`,
    };

    return emailMessage;
  }

  @CaptureSpan()
  public async generateEmailTemplateForIncidentCreated(
    to: Email,
    incident: Incident,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<EmailMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const incidentNumber: string = incident.incidentNumberWithPrefix
      || (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

    const vars: Dictionary<string> = {
      incidentTitle: incident.title!,
      incidentNumber: incidentNumber,
      projectName: incident.project!.name!,
      currentState: incident.currentIncidentState!.name!,
      incidentDescription: await Markdown.convertToHTML(
        incident.description! || "",
        MarkdownContentType.Email,
      ),
      incidentSeverity: incident.incidentSeverity!.name!,
      rootCause:
        incident.rootCause || "No root cause identified for this incident",
      incidentViewLink: (
        await IncidentService.getIncidentLinkInDashboard(
          incident.projectId!,
          incident.id!,
        )
      ).toString(),
      acknowledgeIncidentLink: new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ).toString(),
    };

    const emailMessage: EmailMessage = {
      toEmail: to!,
      templateType: EmailTemplateType.AcknowledgeIncident,
      vars: vars,
      subject: `ACTION REQUIRED: Incident ${incidentNumber} created - ${incident.title!}`,
    };

    return emailMessage;
  }

  @CaptureSpan()
  public async generateEmailTemplateForAlertEpisodeCreated(
    to: Email,
    alertEpisode: AlertEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<EmailMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    // Fetch alerts that are members of this episode
    const episodeMembers: Array<AlertEpisodeMember> =
      await AlertEpisodeMemberService.findBy({
        query: {
          alertEpisodeId: alertEpisode.id!,
        },
        select: {
          alertId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    // Get the alert IDs
    const alertIds: Array<ObjectID> = episodeMembers
      .map((member: AlertEpisodeMember) => {
        return member.alertId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return id !== undefined;
      });

    // Fetch full alert data with monitors
    const alerts: Array<Alert> =
      alertIds.length > 0
        ? await AlertService.findBy({
            query: {
              _id: QueryHelper.any(alertIds),
            },
            select: {
              _id: true,
              title: true,
              alertNumber: true,
              monitor: {
                _id: true,
                name: true,
              },
            },
            props: {
              isRoot: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
          })
        : [];

    // Get unique monitors (resources affected)
    const monitorNames: Set<string> = new Set();
    for (const alert of alerts) {
      if (alert.monitor?.name) {
        monitorNames.add(alert.monitor.name);
      }
    }

    const resourcesAffected: string =
      monitorNames.size > 0
        ? Array.from(monitorNames).join(", ")
        : "No resources identified";

    // Build alerts list HTML with proper email styling
    let alertsListHtml: string = "";
    if (alerts.length > 0) {
      const alertRows: string[] = [];
      for (const alert of alerts) {
        const alertTitle: string = alert.title || "Untitled Alert";
        const alertNumber: string = alert.alertNumber
          ? `#${alert.alertNumber}`
          : "";
        const alertLink: string = (
          await AlertService.getAlertLinkInDashboard(
            alertEpisode.projectId!,
            alert.id!,
          )
        ).toString();
        const monitorName: string = alert.monitor?.name || "";

        alertRows.push(`
            <tr>
              <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0;">
                <table cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="vertical-align: middle;">
                      <span style="display: inline-block; background-color: #dbeafe; color: #1e40af; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; margin-right: 8px;">${alertNumber}</span>
                      <a href="${alertLink}" style="color: #2563eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; font-weight: 500; text-decoration: none;">${alertTitle}</a>
                      ${monitorName ? `<span style="display: block; color: #64748b; font-size: 12px; margin-top: 4px;">Monitor: ${monitorName}</span>` : ""}
                    </td>
                    <td style="text-align: right; vertical-align: middle;">
                      <a href="${alertLink}" style="color: #2563eb; font-size: 12px; text-decoration: none;">View →</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          `);
      }
      if (alertRows.length > 0) {
        alertsListHtml = `
          <table cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 8px; border: 1px solid #e2e8f0; margin: 8px 0 16px 0;">
            <tbody>
              ${alertRows.join("")}
            </tbody>
          </table>
        `;
      }
    }

    const episodeNumber: string = alertEpisode.episodeNumberWithPrefix
      || (alertEpisode.episodeNumber
        ? `#${alertEpisode.episodeNumber}`
        : "");

    const vars: Dictionary<string> = {
      alertEpisodeTitle: alertEpisode.title!,
      episodeNumber: episodeNumber,
      projectName: alertEpisode.project!.name!,
      currentState: alertEpisode.currentAlertState!.name!,
      alertEpisodeDescription: await Markdown.convertToHTML(
        alertEpisode.description! || "",
        MarkdownContentType.Email,
      ),
      alertEpisodeSeverity: alertEpisode.alertSeverity!.name!,
      resourcesAffected: resourcesAffected,
      rootCause:
        alertEpisode.rootCause ||
        "No root cause identified for this alert episode",
      alertsList: alertsListHtml,
      alertsCount: alerts.length.toString(),
      alertEpisodeViewLink: (
        await AlertEpisodeService.getEpisodeLinkInDashboard(
          alertEpisode.projectId!,
          alertEpisode.id!,
        )
      ).toString(),
      acknowledgeAlertEpisodeLink: new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ).toString(),
    };

    const emailMessage: EmailMessage = {
      toEmail: to!,
      templateType: EmailTemplateType.AcknowledgeAlertEpisode,
      vars: vars,
      subject: `ACTION REQUIRED: Alert Episode ${episodeNumber} created - ${alertEpisode.title!}`,
    };

    return emailMessage;
  }

  @CaptureSpan()
  public async startUserNotificationRulesExecution(
    userId: ObjectID,
    options: {
      projectId: ObjectID;
      triggeredByIncidentId?: ObjectID | undefined;
      triggeredByAlertId?: ObjectID | undefined;
      triggeredByAlertEpisodeId?: ObjectID | undefined;
      triggeredByIncidentEpisodeId?: ObjectID | undefined;
      userNotificationEventType: UserNotificationEventType;
      onCallPolicyExecutionLogId?: ObjectID | undefined;
      onCallPolicyId: ObjectID | undefined;
      onCallPolicyEscalationRuleId?: ObjectID | undefined;
      userBelongsToTeamId?: ObjectID | undefined;
      onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
      overridedByUserId?: ObjectID | undefined;
    },
  ): Promise<void> {
    // add user notification log.
    const userOnCallLog: UserOnCallLog = new UserOnCallLog();

    userOnCallLog.userId = userId;
    userOnCallLog.projectId = options.projectId;

    if (options.triggeredByIncidentId) {
      userOnCallLog.triggeredByIncidentId = options.triggeredByIncidentId;
    }

    if (options.triggeredByAlertId) {
      userOnCallLog.triggeredByAlertId = options.triggeredByAlertId;
    }

    if (options.triggeredByAlertEpisodeId) {
      userOnCallLog.triggeredByAlertEpisodeId =
        options.triggeredByAlertEpisodeId;
    }

    if (options.triggeredByIncidentEpisodeId) {
      userOnCallLog.triggeredByIncidentEpisodeId =
        options.triggeredByIncidentEpisodeId;
    }

    userOnCallLog.userNotificationEventType = options.userNotificationEventType;

    if (options.onCallPolicyExecutionLogId) {
      userOnCallLog.onCallDutyPolicyExecutionLogId =
        options.onCallPolicyExecutionLogId;
    }

    if (options.onCallPolicyId) {
      userOnCallLog.onCallDutyPolicyId = options.onCallPolicyId;
    }

    if (options.onCallDutyPolicyExecutionLogTimelineId) {
      userOnCallLog.onCallDutyPolicyExecutionLogTimelineId =
        options.onCallDutyPolicyExecutionLogTimelineId;
    }

    if (options.onCallPolicyEscalationRuleId) {
      userOnCallLog.onCallDutyPolicyEscalationRuleId =
        options.onCallPolicyEscalationRuleId;
    }

    if (options.userBelongsToTeamId) {
      userOnCallLog.userBelongsToTeamId = options.userBelongsToTeamId;
    }

    if (options.onCallScheduleId) {
      userOnCallLog.onCallDutyScheduleId = options.onCallScheduleId;
    }

    userOnCallLog.status = UserNotificationExecutionStatus.Scheduled;
    userOnCallLog.statusMessage = "Scheduled";

    if (options.overridedByUserId) {
      userOnCallLog.overridedByUserId = options.overridedByUserId;
    }

    await UserOnCallLogService.create({
      data: userOnCallLog,
      props: {
        isRoot: true,
      },
    });

    // Alert workspace here. Invite users to channels for example. If they are not invited.

    this.runWorkspaceRulesForOnCallNotification({
      projectId: options.projectId,
      alertId: options.triggeredByAlertId,
      incidentId: options.triggeredByIncidentId,
      userId: userId,
    }).catch((error: Error) => {
      logger.error(error);
    });
  }

  @CaptureSpan()
  public async runWorkspaceRulesForOnCallNotification(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    userId: ObjectID;
  }): Promise<void> {
    // if alert and incidient are both present, then throw an error.
    if (data.incidentId && data.alertId) {
      throw new BadDataException("Either incidentId or alertId is required.");
    }

    // if none are present, then throw an error.

    if (!data.incidentId && !data.alertId) {
      throw new BadDataException("Either incidentId or alertId is required.");
    }

    // get notification rule where inviteOwners is true.
    const notificationRules: Array<WorkspaceNotificationRule> =
      await WorkspaceNotificationRuleService.getNotificationRulesWhereInviteOwnersIsTrue(
        {
          projectId: data.projectId!,
          notificationFor: {
            incidentId: data.incidentId,
            alertId: data.alertId,
          },
          notificationRuleEventType: data.incidentId
            ? NotificationRuleEventType.Incident
            : NotificationRuleEventType.Alert,
        },
      );

    let workspaceChannels: Array<NotificationRuleWorkspaceChannel> = [];

    if (data.incidentId) {
      workspaceChannels = await IncidentService.getWorkspaceChannelForIncident({
        incidentId: data.incidentId!,
      });
    }

    if (data.alertId) {
      workspaceChannels = await AlertService.getWorkspaceChannelForAlert({
        alertId: data.alertId!,
      });
    }

    WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        notificationRules: notificationRules,
        projectId: data.projectId!,
        workspaceChannels: workspaceChannels,
        userIds: [data.userId],
      },
    ).catch((error: Error) => {
      logger.error(error);
    });
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (
      !createBy.data.userCallId &&
      !createBy.data.userCall &&
      !createBy.data.userEmail &&
      !createBy.data.userSms &&
      !createBy.data.userSmsId &&
      !createBy.data.userWhatsApp &&
      !createBy.data.userWhatsAppId &&
      !createBy.data.userEmailId &&
      !createBy.data.userPushId &&
      !createBy.data.userPush
    ) {
      throw new BadDataException(
        "Call, SMS, WhatsApp, Email, or Push notification is required",
      );
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  public async addDefaultIncidentNotificationRuleForUser(data: {
    projectId: ObjectID;
    userId: ObjectID;
    userEmail: UserEmail;
  }): Promise<void> {
    const { projectId, userId, userEmail } = data;

    const incidentSeverities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: {
          projectId,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
        },
      });

    // create for incident severities.
    for (const incidentSeverity of incidentSeverities) {
      //check if this rule already exists.
      const existingRule: Model | null = await this.findOneBy({
        query: {
          projectId,
          userId,
          userEmailId: userEmail.id!,
          incidentSeverityId: incidentSeverity.id!,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        },
        props: {
          isRoot: true,
        },
      });

      if (existingRule) {
        continue; // skip this rule.
      }

      const notificationRule: Model = new Model();

      notificationRule.projectId = projectId;
      notificationRule.userId = userId;
      notificationRule.userEmailId = userEmail.id!;
      notificationRule.incidentSeverityId = incidentSeverity.id!;
      notificationRule.notifyAfterMinutes = 0;
      notificationRule.ruleType =
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;

      await this.create({
        data: notificationRule,
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public async addDefaultAlertNotificationRulesForUser(data: {
    projectId: ObjectID;
    userId: ObjectID;
    userEmail: UserEmail;
  }): Promise<void> {
    const { projectId, userId, userEmail } = data;

    const alertSeverities: Array<AlertSeverity> =
      await AlertSeverityService.findBy({
        query: {
          projectId,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
        },
      });

    // create for Alert severities.
    for (const alertSeverity of alertSeverities) {
      //check if this rule already exists.
      const existingRule: Model | null = await this.findOneBy({
        query: {
          projectId,
          userId,
          userEmailId: userEmail.id!,
          alertSeverityId: alertSeverity.id!,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        },
        props: {
          isRoot: true,
        },
      });

      if (existingRule) {
        continue; // skip this rule.
      }

      const notificationRule: Model = new Model();

      notificationRule.projectId = projectId;
      notificationRule.userId = userId;
      notificationRule.userEmailId = userEmail.id!;
      notificationRule.alertSeverityId = alertSeverity.id!;
      notificationRule.notifyAfterMinutes = 0;
      notificationRule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_ALERT;

      await this.create({
        data: notificationRule,
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public async addDefaultNotificationRuleForUser(
    projectId: ObjectID,
    userId: ObjectID,
    email: Email,
  ): Promise<void> {
    let userEmail: UserEmail | null = await UserEmailService.findOneBy({
      query: {
        projectId,
        userId,
        email,
      },
      props: {
        isRoot: true,
      },
    });

    if (!userEmail) {
      userEmail = new UserEmail();
      userEmail.projectId = projectId;
      userEmail.userId = userId;
      userEmail.email = email;
      userEmail.isVerified = true;

      userEmail = await UserEmailService.create({
        data: userEmail,
        props: {
          isRoot: true,
        },
      });
    }

    // add default incident rules for user
    await this.addDefaultIncidentNotificationRuleForUser({
      projectId,
      userId,
      userEmail,
    });

    // add default alert rules for user, just like the incident

    await this.addDefaultAlertNotificationRulesForUser({
      projectId,
      userId,
      userEmail,
    });

    //check if this rule already exists.
    const existingRuleOnCall: Model | null = await this.findOneBy({
      query: {
        projectId,
        userId,
        userEmailId: userEmail.id!,
        ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
      },
      props: {
        isRoot: true,
      },
    });

    if (!existingRuleOnCall) {
      // on and off call.
      const onCallRule: Model = new Model();

      onCallRule.projectId = projectId;
      onCallRule.userId = userId;
      onCallRule.userEmailId = userEmail.id!;
      onCallRule.notifyAfterMinutes = 0;
      onCallRule.ruleType = NotificationRuleType.WHEN_USER_GOES_ON_CALL;

      await this.create({
        data: onCallRule,
        props: {
          isRoot: true,
        },
      });
    }

    //check if this rule already exists.
    const existingRuleOffCall: Model | null = await this.findOneBy({
      query: {
        projectId,
        userId,
        userEmailId: userEmail.id!,
        ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
      },
      props: {
        isRoot: true,
      },
    });

    if (!existingRuleOffCall) {
      // on and off call.
      const offCallRule: Model = new Model();

      offCallRule.projectId = projectId;
      offCallRule.userId = userId;
      offCallRule.userEmailId = userEmail.id!;
      offCallRule.notifyAfterMinutes = 0;
      offCallRule.ruleType = NotificationRuleType.WHEN_USER_GOES_OFF_CALL;

      await this.create({
        data: offCallRule,
        props: {
          isRoot: true,
        },
      });
    }
  }
}
export default new Service();
