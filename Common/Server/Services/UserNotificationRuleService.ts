import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import Markdown, { MarkdownContentType } from "../Types/Markdown";
import CallService from "./CallService";
import DatabaseService from "./DatabaseService";
import IncidentService from "./IncidentService";
import IncidentSeverityService from "./IncidentSeverityService";
import MailService from "./MailService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ShortLinkService from "./ShortLinkService";
import SmsService from "./SmsService";
import TelegramService from "./TelegramService";
import WebhookService from "./WebhookService";
import WhatsAppService from "./WhatsAppService";
import UserEmailService from "./UserEmailService";
import UserCallService from "./UserCallService";
import UserPushService from "./UserPushService";
import UserSmsService from "./UserSmsService";
import UserTelegramService from "./UserTelegramService";
import UserWebhookService from "./UserWebhookService";
import UserWhatsAppService from "./UserWhatsAppService";
import ProjectService from "./ProjectService";
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
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import EmailMessage from "../../Types/Email/EmailMessage";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../Types/ObjectID";
import PushDeviceType from "../../Types/PushNotification/PushDeviceType";
import Phone from "../../Types/Phone";
import SMS from "../../Types/SMS/SMS";
import TelegramMessage from "../../Types/Telegram/TelegramMessage";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
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
import Monitor from "../../Models/DatabaseModels/Monitor";
import Project from "../../Models/DatabaseModels/Project";
import ShortLink from "../../Models/DatabaseModels/ShortLink";
import UserCall from "../../Models/DatabaseModels/UserCall";
import UserEmail from "../../Models/DatabaseModels/UserEmail";
import UserPush from "../../Models/DatabaseModels/UserPush";
import UserSMS from "../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../Models/DatabaseModels/UserWhatsApp";
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
import IncidentEpisodeMember from "../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeMemberService from "./IncidentEpisodeMemberService";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import PushNotificationService from "./PushNotificationService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface NotificationMethodDescriptor {
  userEmailId?: ObjectID;
  userSmsId?: ObjectID;
  userCallId?: ObjectID;
  userWhatsAppId?: ObjectID;
  userTelegramId?: ObjectID;
  userPushId?: ObjectID;
  userWebhookId?: ObjectID;
}

/*
 * Everything a single delivery attempt needs to know about the page it is
 * carrying: which project, which entity fired it, which escalation produced it,
 * and which UserOnCallLog row it must reconcile against. This used to be an
 * inline object literal on executeNotificationRuleItem; it is named here because
 * the fallback path (executeFallbackNotification) hands the very same bundle to
 * the very same delivery code, and because callers outside this file now need to
 * be able to type a variable against it.
 */
export interface ExecuteNotificationRuleOptions {
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
}

export interface ExecuteFallbackNotificationOptions
  extends ExecuteNotificationRuleOptions {
  userId: ObjectID;
  userOnCallLogId: ObjectID;
  ruleType: NotificationRuleType;
  // Only used to explain, in prose, which severity had no rule configured.
  severityName: string;
}

/*
 * Why the fallback returns an outcome and not just a boolean.
 *
 * Its caller (UserOnCallLogService.onCreateSuccess) has to pick a
 * UserNotificationExecutionStatus out of the answer, and
 * UserNotificationExecutionStatus.Error is TERMINAL — ExecutePendingExecutions
 * selects Executing and TimeoutStuckExecutions selects Started, so nothing
 * anywhere re-selects an Error log. That makes the two ways of not notifying
 * somebody opposites rather than synonyms: "this responder has nothing we can
 * page them on" is a real, permanent misconfiguration worth burning the log
 * for, while "the send raised" is a bad minute that a terminal status would
 * turn into a permanently dropped page. Both are `notified: false`, so the
 * difference has to survive the return or the caller cannot act on it.
 */
export enum FallbackNotificationOutcome {
  /*
   * A page was handed to at least one sender. Nothing below observes what the
   * sender then did with it — every send in deliverNotificationForRule is
   * fire-and-forget — so this means dispatched, not received.
   */
  Delivered = "Delivered",

  /*
   * There was nothing to try. The responder has no verified method the
   * fallback may use and no webhook, or the only paid channels they have are
   * switched off at the project level. Permanent: a retry finds the same
   * nothing, and only a human adding a notification method changes it.
   */
  NoUsableNotificationMethod = "NoUsableNotificationMethod",

  /*
   * There was something to try and none of it went out: a send raised, or a
   * chosen channel had no template for this event type, or another run already
   * holds the fallback claim on this log and owns the outcome. All three are
   * transient from the caller's point of view — none of them is evidence that
   * the responder is unreachable, so none of them justifies a terminal status.
   */
  DeliveryFailed = "DeliveryFailed",
}

export interface FallbackNotificationResult {
  outcome: FallbackNotificationOutcome;
  /*
   * Mirror of `outcome === FallbackNotificationOutcome.Delivered`, kept because
   * most read sites only want the yes/no and re-deriving the comparison at each
   * one is how a caller ends up asserting the wrong half of the enum.
   */
  notified: boolean;
  channelsUsed: Array<string>;
}

/*
 * The fallback is not tied to any UserNotificationRule row — there is no rule,
 * which is the whole reason it runs — so it claims the on-call log under this
 * reserved literal instead of a rule id. `executedNotificationRules` is a jsonb
 * map keyed by arbitrary text, so the literal sits beside real rule uuids and
 * can never collide with one.
 */
export const FALLBACK_NOTIFICATION_CLAIM_KEY: string = "__fallback__";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async executeNotificationRuleItem(
    userNotificationRuleId: ObjectID,
    options: ExecuteNotificationRuleOptions,
  ): Promise<void> {
    /*
     * Atomically claim this rule for this on-call log BEFORE sending, so two
     * overlapping cron runs cannot both mark the rule un-executed and both
     * notify — double-paging the responder for one escalation (audit F7). The
     * previous read-check-then-blind-save was a non-atomic TOCTOU. If the claim
     * was already taken (or the log is gone), skip.
     */
    const claimedRuleExecution: boolean =
      await UserOnCallLogService.claimNotificationRuleExecution({
        userOnCallLogId: options.userNotificationLogId,
        userNotificationRuleId: userNotificationRuleId,
      });

    if (!claimedRuleExecution) {
      // already executed by this or a concurrent run.
      return;
    }

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
        userTelegram: {
          telegramChatId: true,
          telegramUserHandle: true,
          isVerified: true,
        },
        userWebhook: {
          webhookUrl: true,
          name: true,
          secret: true,
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

    await this.deliverNotificationForRule(notificationRuleItem, options);
  }

  /*
   * Build the timeline row every channel block stamps its status onto.
   *
   * Callers keep ONE instance and mutate it, because after the first create()
   * the instance carries an _id and a second create() with it UPDATEs the row
   * it already wrote instead of inserting a new one. Anything that needs a row
   * genuinely independent of the delivery attempts (the fell-through guard
   * below) must therefore call this again for a fresh instance rather than
   * reuse the one the channel blocks have been writing to.
   */
  private buildLogTimelineItem(
    notificationRuleItem: Model,
    options: ExecuteNotificationRuleOptions,
  ): UserOnCallLogTimeline {
    const logTimelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    logTimelineItem.projectId = options.projectId;
    logTimelineItem.userNotificationLogId = options.userNotificationLogId;
    logTimelineItem.userId = notificationRuleItem.userId!;
    logTimelineItem.userNotificationEventType =
      options.userNotificationEventType;

    /*
     * The fallback delivers through rules it builds in memory and never saves,
     * so there is not always a rule id to point the row at.
     */
    if (notificationRuleItem.id) {
      logTimelineItem.userNotificationRuleId = notificationRuleItem.id;
    }

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

    return logTimelineItem;
  }

  /*
   * The delivery half of executeNotificationRuleItem: given a rule that is
   * already loaded with its method relations, decide what to send on which
   * channel and hand it to the senders.
   *
   * It is split out from the public method so executeFallbackNotification can
   * reuse it with a rule it assembled in memory and never persisted. The claim
   * and the rule lookup that the public method does first are meaningless for a
   * rule that does not exist in the database; everything from here down is
   * exactly what the fallback needs.
   *
   * Returns whether a page was actually handed to a sender, which the fallback
   * needs and the normal path ignores. Resolving without throwing is NOT the
   * same as having sent something: a rule whose channel has no block for this
   * event type falls all the way through to the guard at the bottom, writes an
   * Error row and sends nothing. A caller that read "did not throw" as "paged"
   * would name a channel the responder never heard from.
   */
  private async deliverNotificationForRule(
    notificationRuleItem: Model,
    options: ExecuteNotificationRuleOptions,
  ): Promise<boolean> {
    /*
     * If the project has a default Twilio config set, use it for all
     * team-member SMS and Calls in this rule. Otherwise the global config
     * is used by the notification service.
     */
    const projectTwilioConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        options.projectId,
      );

    const logTimelineItem: UserOnCallLogTimeline = this.buildLogTimelineItem(
      notificationRuleItem,
      options,
    );

    /*
     * Which channels this rule could actually deliver on, and whether any block
     * below matched the event type. If a channel is contactable but no branch
     * claimed the event, the page vanishes without a trace — the guard at the
     * end of this method turns that into a visible Error row.
     */
    const contactableChannels: Array<string> =
      this.getContactableChannelNames(notificationRuleItem);
    let deliveryAttempted: boolean = false;

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
          alertNumberWithPrefix: true,
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
        deliveryAttempted = true;
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
        deliveryAttempted = true;
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
        deliveryAttempted = true;
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

      // send email for incident episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        deliveryAttempted = true;
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
          await this.generateEmailTemplateForIncidentEpisodeCreated(
            notificationRuleItem.userEmail?.email,
            incidentEpisode,
            updatedLog.id!,
          );

        /*
         * No incidentEpisodeId is passed: MailService.sendMail accepts the key
         * in its options type but never serialises it onto the request body, so
         * passing it would look like a link that does not exist.
         */
        MailService.sendMail(emailMessage, {
          userOnCallLogTimelineId: updatedLog.id!,
          projectId: options.projectId,
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
        deliveryAttempted = true;
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
          customTwilioConfig: projectTwilioConfig,
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
        deliveryAttempted = true;
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
          customTwilioConfig: projectTwilioConfig,
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
        deliveryAttempted = true;
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
          customTwilioConfig: projectTwilioConfig,
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

      // send sms for incident episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        deliveryAttempted = true;
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
          await this.generateSmsTemplateForIncidentEpisodeCreated(
            notificationRuleItem.userSms.phone,
            incidentEpisode,
            updatedLog.id!,
          );

        /*
         * SmsService accepts incidentEpisodeId but drops it on the floor when
         * building the request body, so it is deliberately not passed here.
         */
        SmsService.sendSms(smsMessage, {
          projectId: incidentEpisode.projectId,
          customTwilioConfig: projectTwilioConfig,
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
        deliveryAttempted = true;
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
        deliveryAttempted = true;
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
        deliveryAttempted = true;
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

      // send WhatsApp for incident episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        deliveryAttempted = true;
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
          await this.generateWhatsAppTemplateForIncidentEpisodeCreated(
            notificationRuleItem.userWhatsApp.phone,
            incidentEpisode,
            updatedLog.id!,
          );

        /*
         * WhatsAppService accepts incidentEpisodeId but never writes it onto
         * the request body, so it is deliberately not passed here.
         */
        WhatsAppService.sendWhatsAppMessage(whatsAppMessage, {
          projectId: incidentEpisode.projectId,
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

    // send Telegram.
    if (
      notificationRuleItem.userTelegram?.telegramChatId &&
      notificationRuleItem.userTelegram?.isVerified
    ) {
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending Telegram message.`;
        logTimelineItem.userTelegramId = notificationRuleItem.userTelegram.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const telegramMessage: TelegramMessage = {
          to: notificationRuleItem.userTelegram.telegramChatId,
          body: await this.generateTelegramBodyForAlertCreated(
            alert,
            updatedLog.id!,
          ),
          parseMode: "HTML",
          disableWebPagePreview: true,
        };

        TelegramService.sendTelegramMessage(telegramMessage, {
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
              statusMessage: err.message || "Error sending Telegram message.",
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
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending Telegram message.`;
        logTimelineItem.userTelegramId = notificationRuleItem.userTelegram.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const telegramMessage: TelegramMessage = {
          to: notificationRuleItem.userTelegram.telegramChatId,
          body: await this.generateTelegramBodyForIncidentCreated(
            incident,
            updatedLog.id!,
          ),
          parseMode: "HTML",
          disableWebPagePreview: true,
        };

        TelegramService.sendTelegramMessage(telegramMessage, {
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
              statusMessage: err.message || "Error sending Telegram message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending Telegram message.`;
        logTimelineItem.userTelegramId = notificationRuleItem.userTelegram.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const telegramMessage: TelegramMessage = {
          to: notificationRuleItem.userTelegram.telegramChatId,
          body: await this.generateTelegramBodyForAlertEpisodeCreated(
            alertEpisode,
            updatedLog.id!,
          ),
          parseMode: "HTML",
          disableWebPagePreview: true,
        };

        TelegramService.sendTelegramMessage(telegramMessage, {
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
              statusMessage: err.message || "Error sending Telegram message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending Telegram message.`;
        logTimelineItem.userTelegramId = notificationRuleItem.userTelegram.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const telegramMessage: TelegramMessage = {
          to: notificationRuleItem.userTelegram.telegramChatId,
          body: await this.generateTelegramBodyForIncidentEpisodeCreated(
            incidentEpisode,
            updatedLog.id!,
          ),
          parseMode: "HTML",
          disableWebPagePreview: true,
        };

        /*
         * TelegramService accepts incidentEpisodeId but never writes it onto
         * the request body, so it is deliberately not passed here.
         */
        TelegramService.sendTelegramMessage(telegramMessage, {
          projectId: incidentEpisode.projectId,
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
              statusMessage: err.message || "Error sending Telegram message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }
    }

    if (
      notificationRuleItem.userTelegram &&
      !notificationRuleItem.userTelegram?.isVerified
    ) {
      logTimelineItem.status = UserNotificationStatus.Error;
      logTimelineItem.statusMessage = `Telegram message not sent because the Telegram account is not verified.`;
      logTimelineItem.userTelegramId = notificationRuleItem.userTelegram.id!;

      await UserOnCallLogTimelineService.create({
        data: logTimelineItem,
        props: {
          isRoot: true,
        },
      });
    }

    // send webhook.
    if (notificationRuleItem.userWebhook?.webhookUrl) {
      const webhookUrl: string = notificationRuleItem.userWebhook.webhookUrl;
      const webhookSecret: string | undefined =
        notificationRuleItem.userWebhook.secret;
      const userWebhookId: ObjectID = notificationRuleItem.userWebhook.id!;

      const dispatchWebhook: (params: {
        eventType: string;
        payload: JSONObject;
        entityId?: ObjectID;
        entityKind: "alert" | "incident" | "alertEpisode" | "incidentEpisode";
      }) => Promise<void> = async (params: {
        eventType: string;
        payload: JSONObject;
        entityId?: ObjectID;
        entityKind: "alert" | "incident" | "alertEpisode" | "incidentEpisode";
      }): Promise<void> => {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending webhook to ${webhookUrl}.`;
        logTimelineItem.userWebhookId = userWebhookId;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const callbacksByKind: {
          alert?: { alertId?: ObjectID };
          incident?: { incidentId?: ObjectID };
        } = {};
        if (params.entityKind === "alert" && params.entityId) {
          callbacksByKind.alert = { alertId: params.entityId };
        } else if (params.entityKind === "incident" && params.entityId) {
          callbacksByKind.incident = { incidentId: params.entityId };
        }

        WebhookService.sendWebhook(
          {
            url: webhookUrl,
            eventType: params.eventType,
            payload: params.payload,
            secret: webhookSecret,
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: updatedLog.id!,
            userId: notificationRuleItem.userId!,
            onCallPolicyId: options.onCallPolicyId,
            onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
            teamId: options.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              options.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: options.onCallScheduleId,
            ...callbacksByKind.alert,
            ...callbacksByKind.incident,
          },
        ).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending webhook.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      };

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        await dispatchWebhook({
          eventType: "on-call.alert.created",
          entityKind: "alert",
          entityId: alert.id!,
          payload: {
            eventType: "on-call.alert.created",
            timestamp: new Date().toISOString(),
            projectId: alert.projectId?.toString() || "",
            userId: notificationRuleItem.userId!.toString(),
            alert: {
              id: alert.id?.toString() || "",
              title: alert.title || "",
              description: alert.description || "",
              alertNumber: alert.alertNumber || null,
              alertNumberWithPrefix: alert.alertNumberWithPrefix || null,
              severity: alert.alertSeverity?.name || null,
              state: alert.currentAlertState?.name || null,
            },
            onCallPolicyId: options.onCallPolicyId?.toString() || null,
            onCallPolicyEscalationRuleId:
              options.onCallPolicyEscalationRuleId?.toString() || null,
          },
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        await dispatchWebhook({
          eventType: "on-call.incident.created",
          entityKind: "incident",
          entityId: incident.id!,
          payload: {
            eventType: "on-call.incident.created",
            timestamp: new Date().toISOString(),
            projectId: incident.projectId?.toString() || "",
            userId: notificationRuleItem.userId!.toString(),
            incident: {
              id: incident.id?.toString() || "",
              title: incident.title || "",
              description: incident.description || "",
              incidentNumber: incident.incidentNumber || null,
              incidentNumberWithPrefix:
                incident.incidentNumberWithPrefix || null,
              severity: incident.incidentSeverity?.name || null,
              state: incident.currentIncidentState?.name || null,
            },
            onCallPolicyId: options.onCallPolicyId?.toString() || null,
            onCallPolicyEscalationRuleId:
              options.onCallPolicyEscalationRuleId?.toString() || null,
          },
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        await dispatchWebhook({
          eventType: "on-call.alertEpisode.created",
          entityKind: "alertEpisode",
          payload: {
            eventType: "on-call.alertEpisode.created",
            timestamp: new Date().toISOString(),
            projectId: alertEpisode.projectId?.toString() || "",
            userId: notificationRuleItem.userId!.toString(),
            alertEpisode: {
              id: alertEpisode.id?.toString() || "",
              title: alertEpisode.title || "",
              description: alertEpisode.description || "",
              episodeNumber: alertEpisode.episodeNumber || null,
              episodeNumberWithPrefix:
                alertEpisode.episodeNumberWithPrefix || null,
              severity: alertEpisode.alertSeverity?.name || null,
              state: alertEpisode.currentAlertState?.name || null,
            },
            onCallPolicyId: options.onCallPolicyId?.toString() || null,
            onCallPolicyEscalationRuleId:
              options.onCallPolicyEscalationRuleId?.toString() || null,
          },
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        await dispatchWebhook({
          eventType: "on-call.incidentEpisode.created",
          entityKind: "incidentEpisode",
          payload: {
            eventType: "on-call.incidentEpisode.created",
            timestamp: new Date().toISOString(),
            projectId: incidentEpisode.projectId?.toString() || "",
            userId: notificationRuleItem.userId!.toString(),
            incidentEpisode: {
              id: incidentEpisode.id?.toString() || "",
              title: incidentEpisode.title || "",
              description: incidentEpisode.description || "",
              episodeNumber: incidentEpisode.episodeNumber || null,
              episodeNumberWithPrefix:
                incidentEpisode.episodeNumberWithPrefix || null,
              severity: incidentEpisode.incidentSeverity?.name || null,
              state: incidentEpisode.currentIncidentState?.name || null,
            },
            onCallPolicyId: options.onCallPolicyId?.toString() || null,
            onCallPolicyEscalationRuleId:
              options.onCallPolicyEscalationRuleId?.toString() || null,
          },
        });
      }
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
        deliveryAttempted = true;
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
          customTwilioConfig: projectTwilioConfig,
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
        deliveryAttempted = true;
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
          customTwilioConfig: projectTwilioConfig,
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
        deliveryAttempted = true;
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
          customTwilioConfig: projectTwilioConfig,
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

      // send call for incident episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        deliveryAttempted = true;
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
          await this.generateCallTemplateForIncidentEpisodeCreated(
            notificationRuleItem.userCall?.phone,
            incidentEpisode,
            updatedLog.id!,
          );

        /*
         * CallService accepts incidentEpisodeId but never writes it onto the
         * request body, so it is deliberately not passed here.
         */
        CallService.makeCall(callRequest, {
          projectId: incidentEpisode.projectId,
          customTwilioConfig: projectTwilioConfig,
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
        deliveryAttempted = true;
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
            ...(alert.alertNumberWithPrefix && {
              alertNumberWithPrefix: alert.alertNumberWithPrefix,
            }),
            alertId: alert.id!.toString(),
            projectId: alert.projectId!.toString(),
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
            deviceType: notificationRuleItem.userPush
              .deviceType! as PushDeviceType,
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
        deliveryAttempted = true;
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
            ...(incident.incidentNumberWithPrefix && {
              incidentNumberWithPrefix: incident.incidentNumberWithPrefix,
            }),
            incidentId: incident.id!.toString(),
            projectId: incident.projectId!.toString(),
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
            deviceType: notificationRuleItem.userPush
              .deviceType! as PushDeviceType,
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
        deliveryAttempted = true;
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
            alertEpisodeId: alertEpisode.id!.toString(),
            projectId: alertEpisode.projectId!.toString(),
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
            deviceType: notificationRuleItem.userPush
              .deviceType! as PushDeviceType,
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

      // send push notification for incident episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        deliveryAttempted = true;
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
          PushNotificationUtil.createIncidentEpisodeCreatedNotification({
            incidentEpisodeTitle: incidentEpisode.title!,
            projectName: incidentEpisode.project?.name || "OneUptime",
            incidentEpisodeViewLink: (
              await IncidentEpisodeService.getEpisodeLinkInDashboard(
                incidentEpisode.projectId!,
                incidentEpisode.id!,
              )
            ).toString(),
            ...(incidentEpisode.episodeNumber !== undefined && {
              episodeNumber: incidentEpisode.episodeNumber,
            }),
            ...(incidentEpisode.episodeNumberWithPrefix && {
              episodeNumberWithPrefix: incidentEpisode.episodeNumberWithPrefix,
            }),
            incidentEpisodeId: incidentEpisode.id!.toString(),
            projectId: incidentEpisode.projectId!.toString(),
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
            deviceType: notificationRuleItem.userPush
              .deviceType! as PushDeviceType,
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: updatedLog.id!,
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

    /*
     * The fell-through guard.
     *
     * Gap F was a whole class of lost pages: a contactable channel, an event
     * type that no block in that channel branched on, and therefore neither a
     * send nor an error row — the responder was simply never told, and nothing
     * anywhere recorded that. Rather than trust that every future event type
     * gets wired into all seven blocks, make the omission loud.
     *
     * The row is built fresh instead of reusing logTimelineItem: that instance
     * picks up an _id as soon as any block has created a row with it, and a
     * second create() with it would UPDATE that row rather than insert this one.
     */
    if (contactableChannels.length > 0 && !deliveryAttempted) {
      const statusMessage: string = `No notification template for ${options.userNotificationEventType} on ${contactableChannels.join(", ")}.`;

      const fellThroughRow: UserOnCallLogTimeline = this.buildLogTimelineItem(
        notificationRuleItem,
        options,
      );
      fellThroughRow.status = UserNotificationStatus.Error;
      fellThroughRow.statusMessage = statusMessage;

      await UserOnCallLogTimelineService.create({
        data: fellThroughRow,
        props: {
          isRoot: true,
        },
      });

      logger.error(
        `${statusMessage} User on-call log: ${options.userNotificationLogId.toString()}`,
      );
    }

    return deliveryAttempted;
  }

  /*
   * The channels this rule could actually reach the user on, by display name.
   *
   * These are the same gates each channel block opens with, so an empty list
   * means "this rule can contact nobody" — a rule whose method was
   * cascade-deleted, say — and a non-empty one means a page was expected to go
   * out. Webhooks have no verification concept at all (UserWebhook has no
   * isVerified column), so presence of a URL is the whole gate there.
   */
  private getContactableChannelNames(
    notificationRuleItem: Model,
  ): Array<string> {
    const channels: Array<string> = [];

    if (
      notificationRuleItem.userEmail?.email &&
      notificationRuleItem.userEmail?.isVerified
    ) {
      channels.push("Email");
    }

    if (
      notificationRuleItem.userSms?.phone &&
      notificationRuleItem.userSms?.isVerified
    ) {
      channels.push("SMS");
    }

    if (
      notificationRuleItem.userWhatsApp?.phone &&
      notificationRuleItem.userWhatsApp?.isVerified
    ) {
      channels.push("WhatsApp");
    }

    if (
      notificationRuleItem.userTelegram?.telegramChatId &&
      notificationRuleItem.userTelegram?.isVerified
    ) {
      channels.push("Telegram");
    }

    if (notificationRuleItem.userWebhook?.webhookUrl) {
      channels.push("Webhook");
    }

    if (
      notificationRuleItem.userCall?.phone &&
      notificationRuleItem.userCall?.isVerified
    ) {
      channels.push("Call");
    }

    if (
      notificationRuleItem.userPush?.deviceToken &&
      notificationRuleItem.userPush?.isVerified
    ) {
      channels.push("Push");
    }

    return channels;
  }

  /*
   * Page a responder who has NO notification rule matching what just fired.
   *
   * Zero matching rules is indistinguishable from "never configured" unless the
   * user said otherwise, so the caller (UserOnCallLogService.onCreateSuccess)
   * checks for an explicit opt-out row first and only reaches here when the
   * silence looks accidental. Reaching a human on whatever they have verified
   * beats honouring a configuration they never made.
   *
   * Nothing here observes delivery success: every send below is fire-and-forget
   * (see deliverNotificationForRule), so `notified` means "a page was handed to
   * the sender", not "a phone rang".
   *
   * The three ways this can end are spelled out in FallbackNotificationOutcome,
   * and the caller must branch on them rather than on `notified` alone: only
   * NoUsableNotificationMethod describes a responder who cannot be reached, and
   * only that one is safe to record as a terminal status.
   */
  @CaptureSpan()
  public async executeFallbackNotification(
    options: ExecuteFallbackNotificationOptions,
  ): Promise<FallbackNotificationResult> {
    /*
     * Claim the log under the reserved fallback key before doing anything, so
     * two overlapping cron ticks cannot both fall back and double-page the same
     * responder for one escalation.
     */
    const claimed: boolean =
      await UserOnCallLogService.claimNotificationExecution({
        userOnCallLogId: options.userOnCallLogId,
        claimKey: FALLBACK_NOTIFICATION_CLAIM_KEY,
      });

    if (!claimed) {
      /*
       * A concurrent run already fell back for this log; it owns everything
       * that happens next, including the log's final status. Reported as the
       * transient outcome rather than as "no usable method", because the
       * caller's response to the latter is a terminal Error — which would
       * stamp "this responder is unreachable" over a page that is in flight.
       */
      return {
        outcome: FallbackNotificationOutcome.DeliveryFailed,
        notified: false,
        channelsUsed: [],
      };
    }

    const fallbackRules: Array<{ channelName: string; rule: Model }> =
      await this.chooseFallbackChannels(options);

    if (fallbackRules.length === 0) {
      logger.warn(
        `On-call fallback found no usable notification method for user ${options.userId.toString()} in project ${options.projectId.toString()} (${options.severityName} ${options.ruleType}). The page cannot be delivered.`,
      );

      return {
        outcome: FallbackNotificationOutcome.NoUsableNotificationMethod,
        notified: false,
        channelsUsed: [],
      };
    }

    const channelsUsed: Array<string> = [];
    let anAttemptFailed: boolean = false;

    /*
     * One delivery call per channel, never a loop inside one call: the timeline
     * row is a single mutable object inside deliverNotificationForRule, and a
     * second create() with it would UPDATE the row the first channel wrote
     * instead of inserting a second one — the second page would vanish from the
     * timeline and, worse, overwrite the first one's status.
     */
    for (const fallbackRule of fallbackRules) {
      try {
        const dispatched: boolean = await this.deliverNotificationForRule(
          fallbackRule.rule,
          options,
        );

        /*
         * Only a genuine dispatch earns a place in channelsUsed. The channel
         * names in here are read back to the operator as "notified via fallback
         * (Push, Email)", so a name added merely because the call resolved is a
         * lie in the one place somebody looks to find out whether the responder
         * was reached — and deliverNotificationForRule resolves perfectly
         * happily when no block claimed the event type.
         */
        if (dispatched) {
          channelsUsed.push(fallbackRule.channelName);
        } else {
          anAttemptFailed = true;

          logger.error(
            `On-call fallback dispatched nothing on ${fallbackRule.channelName} for user ${options.userId.toString()}: no notification template matched ${options.userNotificationEventType}.`,
          );
        }
      } catch (err) {
        anAttemptFailed = true;

        logger.error(
          `On-call fallback failed to deliver on ${fallbackRule.channelName} for user ${options.userId.toString()}.`,
        );
        logger.error(err);
      }
    }

    if (channelsUsed.length > 0) {
      return {
        outcome: FallbackNotificationOutcome.Delivered,
        notified: true,
        channelsUsed: channelsUsed,
      };
    }

    /*
     * There were channels to try and not one of them carried a page. That is
     * emphatically not the "responder has no notification method" case —
     * chooseFallbackChannels returns only verified, project-enabled methods, so
     * the responder is reachable and today simply failed to be reached.
     *
     * anAttemptFailed is necessarily true on this line, since every path
     * through the loop that does not push a channel sets it. It is read rather
     * than assumed so that a future channel that can finish without either
     * dispatching or failing degrades into the transient outcome instead of
     * silently telling the operator the responder has nothing configured.
     */
    return {
      outcome: anAttemptFailed
        ? FallbackNotificationOutcome.DeliveryFailed
        : FallbackNotificationOutcome.NoUsableNotificationMethod,
      notified: false,
      channelsUsed: [],
    };
  }

  /*
   * Pick what to page the user on, and build an unsaved rule for each choice.
   *
   * Zero-cost channels win: push and email reach the most people for no money
   * and no billing surprise, and there is no reason to pick between them, so a
   * user who has both gets both. Only a user with neither is worth spending on,
   * and then just once, in escalating-intrusiveness order.
   *
   * Paid channels are additionally gated on the project's own enable flags.
   * SmsService and CallService enforce those at send time, but WhatsApp and
   * Telegram only check them when a method is created — so a project that
   * switched WhatsApp off would still be billed by a fallback that did not look.
   */
  private async chooseFallbackChannels(
    options: ExecuteFallbackNotificationOptions,
  ): Promise<Array<{ channelName: string; rule: Model }>> {
    const chosen: Array<{ channelName: string; rule: Model }> = [];

    const userPush: UserPush | null = await UserPushService.findOneBy({
      query: {
        projectId: options.projectId,
        userId: options.userId,
        isVerified: true,
      },
      select: {
        _id: true,
        deviceToken: true,
        deviceType: true,
        isVerified: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (userPush) {
      const rule: Model = this.buildUnsavedFallbackRule(options);
      rule.userPush = userPush;
      rule.userPushId = userPush.id!;
      chosen.push({ channelName: "Push", rule: rule });
    }

    const userEmail: UserEmail | null = await UserEmailService.findOneBy({
      query: {
        projectId: options.projectId,
        userId: options.userId,
        isVerified: true,
      },
      select: {
        _id: true,
        email: true,
        isVerified: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (userEmail) {
      const rule: Model = this.buildUnsavedFallbackRule(options);
      rule.userEmail = userEmail;
      rule.userEmailId = userEmail.id!;
      chosen.push({ channelName: "Email", rule: rule });
    }

    if (chosen.length > 0) {
      return chosen;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: options.projectId,
      select: {
        enableSmsNotifications: true,
        enableCallNotifications: true,
        enableWhatsAppNotifications: true,
        enableTelegramNotifications: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (project?.enableSmsNotifications) {
      const userSms: UserSMS | null = await UserSmsService.findOneBy({
        query: {
          projectId: options.projectId,
          userId: options.userId,
          isVerified: true,
        },
        select: {
          _id: true,
          phone: true,
          isVerified: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (userSms) {
        const rule: Model = this.buildUnsavedFallbackRule(options);
        rule.userSms = userSms;
        rule.userSmsId = userSms.id!;

        return [{ channelName: "SMS", rule: rule }];
      }
    }

    if (project?.enableCallNotifications) {
      const userCall: UserCall | null = await UserCallService.findOneBy({
        query: {
          projectId: options.projectId,
          userId: options.userId,
          isVerified: true,
        },
        select: {
          _id: true,
          phone: true,
          isVerified: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (userCall) {
        const rule: Model = this.buildUnsavedFallbackRule(options);
        rule.userCall = userCall;
        rule.userCallId = userCall.id!;

        return [{ channelName: "Call", rule: rule }];
      }
    }

    if (project?.enableWhatsAppNotifications) {
      const userWhatsApp: UserWhatsApp | null =
        await UserWhatsAppService.findOneBy({
          query: {
            projectId: options.projectId,
            userId: options.userId,
            isVerified: true,
          },
          select: {
            _id: true,
            phone: true,
            isVerified: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (userWhatsApp) {
        const rule: Model = this.buildUnsavedFallbackRule(options);
        rule.userWhatsApp = userWhatsApp;
        rule.userWhatsAppId = userWhatsApp.id!;

        return [{ channelName: "WhatsApp", rule: rule }];
      }
    }

    if (project?.enableTelegramNotifications) {
      const userTelegram: UserTelegram | null =
        await UserTelegramService.findOneBy({
          query: {
            projectId: options.projectId,
            userId: options.userId,
            isVerified: true,
          },
          select: {
            _id: true,
            telegramChatId: true,
            telegramUserHandle: true,
            isVerified: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (userTelegram) {
        const rule: Model = this.buildUnsavedFallbackRule(options);
        rule.userTelegram = userTelegram;
        rule.userTelegramId = userTelegram.id!;

        return [{ channelName: "Telegram", rule: rule }];
      }
    }

    /*
     * A webhook costs the project nothing and has no verification concept at
     * all (UserWebhook has no isVerified column), so its presence is the whole
     * test, and there is no project flag to consult.
     */
    const userWebhook: UserWebhook | null = await UserWebhookService.findOneBy({
      query: {
        projectId: options.projectId,
        userId: options.userId,
      },
      select: {
        _id: true,
        webhookUrl: true,
        name: true,
        secret: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (userWebhook) {
      const rule: Model = this.buildUnsavedFallbackRule(options);
      rule.userWebhook = userWebhook;
      rule.userWebhookId = userWebhook.id!;

      return [{ channelName: "Webhook", rule: rule }];
    }

    return chosen;
  }

  /*
   * A UserNotificationRule that exists only for the length of one delivery.
   *
   * It is never saved: the user did not ask for this rule, and persisting it
   * would silently rewrite their configuration behind their back. The method
   * relation is populated as a loaded entity rather than just its FK because
   * deliverNotificationForRule reads the relation (userEmail.email,
   * userEmail.isVerified) and never dereferences the id.
   */
  private buildUnsavedFallbackRule(
    options: ExecuteFallbackNotificationOptions,
  ): Model {
    const rule: Model = new Model();
    rule.projectId = options.projectId;
    rule.userId = options.userId;
    rule.ruleType = options.ruleType;
    rule.notifyAfterMinutes = 0;

    return rule;
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
          sayMessage: "This is a call from One Uptime",
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
          sayMessage: "This is a call from One Uptime",
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

    const episodeIdentifier: string = alertEpisode.episodeNumberWithPrefix
      ? `Alert episode ${alertEpisode.episodeNumberWithPrefix}, ${alertEpisode.title || "Alert Episode"}`
      : alertEpisode.episodeNumber !== undefined
        ? `Alert episode number ${alertEpisode.episodeNumber}, ${alertEpisode.title || "Alert Episode"}`
        : alertEpisode.title || "Alert Episode";

    const callRequest: CallRequest = {
      to: to,
      data: [
        {
          sayMessage: "This is a call from One Uptime",
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
  public async generateCallTemplateForIncidentEpisodeCreated(
    to: Phone,
    incidentEpisode: IncidentEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<CallRequest> {
    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const episodeIdentifier: string = incidentEpisode.episodeNumberWithPrefix
      ? `Incident episode ${incidentEpisode.episodeNumberWithPrefix}, ${incidentEpisode.title || "Incident Episode"}`
      : incidentEpisode.episodeNumber !== undefined
        ? `Incident episode number ${incidentEpisode.episodeNumber}, ${incidentEpisode.title || "Incident Episode"}`
        : incidentEpisode.title || "Incident Episode";

    const callRequest: CallRequest = {
      to: to,
      data: [
        {
          sayMessage: "This is a call from One Uptime",
        },
        {
          sayMessage: "A new incident episode has been created",
        },
        {
          sayMessage: episodeIdentifier,
        },
        {
          introMessage: "To acknowledge this incident episode press 1",
          numDigits: 1,
          timeoutInSeconds: 10,
          noInputMessage: "You have not entered any input. Good bye",
          onInputCallRequest: {
            "1": {
              sayMessage:
                "You have acknowledged this incident episode. Good bye",
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
        ? `${alert.alertNumberWithPrefix || "#" + alert.alertNumber} (${alert.title || "Alert"})`
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
        ? `${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber} (${incident.title || "Incident"})`
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

    const episodeIdentifier: string = alertEpisode.episodeNumberWithPrefix
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
  public async generateSmsTemplateForIncidentEpisodeCreated(
    to: Phone,
    incidentEpisode: IncidentEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<SMS> {
    const url: URL = await this.buildOnCallAcknowledgeShortUrl(
      userOnCallLogTimelineId,
    );

    const episodeIdentifier: string = incidentEpisode.episodeNumberWithPrefix
      ? `${incidentEpisode.episodeNumberWithPrefix} (${incidentEpisode.title || "Incident Episode"})`
      : incidentEpisode.episodeNumber !== undefined
        ? `#${incidentEpisode.episodeNumber} (${incidentEpisode.title || "Incident Episode"})`
        : incidentEpisode.title || "Incident Episode";

    const sms: SMS = {
      to,
      message: `This is a message from OneUptime. A new incident episode has been created: ${episodeIdentifier}. To acknowledge this incident episode, please click on the following link ${url.toString()}`,
    };

    return sms;
  }

  private async buildOnCallAcknowledgeShortUrl(
    userOnCallLogTimelineId: ObjectID,
  ): Promise<URL> {
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
    return await ShortLinkService.getShortenedUrl(shortUrl);
  }

  /*
   * Telegram's HTML parse_mode supports <b>, <i>, <a>, <code>. Only <, >, and &
   * need escaping inside those tags' text content.
   */
  private escapeTelegramHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  @CaptureSpan()
  public async generateTelegramBodyForAlertCreated(
    alert: Alert,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<string> {
    const ackUrl: URL = await this.buildOnCallAcknowledgeShortUrl(
      userOnCallLogTimelineId,
    );

    const alertIdentifier: string =
      alert.alertNumber !== undefined
        ? `${alert.alertNumberWithPrefix || "#" + alert.alertNumber} — ${alert.title || "Alert"}`
        : alert.title || "Alert";

    const lines: Array<string> = [
      "🚨 <b>New alert assigned to you</b>",
      "",
      `📋 <b>${this.escapeTelegramHtml(alertIdentifier)}</b>`,
      "",
      "👤 You're getting this because you're on call.",
    ];

    if (alert.projectId && alert.id) {
      const dashboardUrl: URL = await AlertService.getAlertLinkInDashboard(
        alert.projectId,
        alert.id,
      );
      lines.push(
        "",
        `🔎 <a href="${this.escapeTelegramHtml(dashboardUrl.toString())}">View alert in OneUptime</a>`,
      );
    }

    lines.push(
      "",
      `✅ <a href="${this.escapeTelegramHtml(ackUrl.toString())}">Tap to acknowledge</a>`,
    );

    return lines.join("\n");
  }

  @CaptureSpan()
  public async generateTelegramBodyForIncidentCreated(
    incident: Incident,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<string> {
    const ackUrl: URL = await this.buildOnCallAcknowledgeShortUrl(
      userOnCallLogTimelineId,
    );

    const incidentIdentifier: string =
      incident.incidentNumber !== undefined
        ? `${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber} — ${incident.title || "Incident"}`
        : incident.title || "Incident";

    const lines: Array<string> = [
      "🔥 <b>New incident assigned to you</b>",
      "",
      `📋 <b>${this.escapeTelegramHtml(incidentIdentifier)}</b>`,
      "",
      "👤 You're getting this because you're on call.",
    ];

    if (incident.projectId && incident.id) {
      const dashboardUrl: URL =
        await IncidentService.getIncidentLinkInDashboard(
          incident.projectId,
          incident.id,
        );
      lines.push(
        "",
        `🔎 <a href="${this.escapeTelegramHtml(dashboardUrl.toString())}">View incident in OneUptime</a>`,
      );
    }

    lines.push(
      "",
      `✅ <a href="${this.escapeTelegramHtml(ackUrl.toString())}">Tap to acknowledge</a>`,
    );

    return lines.join("\n");
  }

  @CaptureSpan()
  public async generateTelegramBodyForAlertEpisodeCreated(
    alertEpisode: AlertEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<string> {
    const ackUrl: URL = await this.buildOnCallAcknowledgeShortUrl(
      userOnCallLogTimelineId,
    );

    const episodeIdentifier: string = alertEpisode.episodeNumberWithPrefix
      ? `${alertEpisode.episodeNumberWithPrefix} — ${alertEpisode.title || "Alert Episode"}`
      : alertEpisode.episodeNumber !== undefined
        ? `#${alertEpisode.episodeNumber} — ${alertEpisode.title || "Alert Episode"}`
        : alertEpisode.title || "Alert Episode";

    const lines: Array<string> = [
      "🔔 <b>New alert episode assigned to you</b>",
      "",
      `📋 <b>${this.escapeTelegramHtml(episodeIdentifier)}</b>`,
      "",
      "👤 You're getting this because you're on call.",
    ];

    if (alertEpisode.projectId && alertEpisode.id) {
      const dashboardUrl: URL =
        await AlertEpisodeService.getEpisodeLinkInDashboard(
          alertEpisode.projectId,
          alertEpisode.id,
        );
      lines.push(
        "",
        `🔎 <a href="${this.escapeTelegramHtml(dashboardUrl.toString())}">View alert episode in OneUptime</a>`,
      );
    }

    lines.push(
      "",
      `✅ <a href="${this.escapeTelegramHtml(ackUrl.toString())}">Tap to acknowledge</a>`,
    );

    return lines.join("\n");
  }

  @CaptureSpan()
  public async generateTelegramBodyForIncidentEpisodeCreated(
    incidentEpisode: IncidentEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<string> {
    const ackUrl: URL = await this.buildOnCallAcknowledgeShortUrl(
      userOnCallLogTimelineId,
    );

    const episodeIdentifier: string = incidentEpisode.episodeNumberWithPrefix
      ? `${incidentEpisode.episodeNumberWithPrefix} — ${incidentEpisode.title || "Incident Episode"}`
      : incidentEpisode.episodeNumber !== undefined
        ? `#${incidentEpisode.episodeNumber} — ${incidentEpisode.title || "Incident Episode"}`
        : incidentEpisode.title || "Incident Episode";

    const lines: Array<string> = [
      "🔥 <b>New incident episode assigned to you</b>",
      "",
      `📋 <b>${this.escapeTelegramHtml(episodeIdentifier)}</b>`,
      "",
      "👤 You're getting this because you're on call.",
    ];

    if (incidentEpisode.projectId && incidentEpisode.id) {
      const dashboardUrl: URL =
        await IncidentEpisodeService.getEpisodeLinkInDashboard(
          incidentEpisode.projectId,
          incidentEpisode.id,
        );
      lines.push(
        "",
        `🔎 <a href="${this.escapeTelegramHtml(dashboardUrl.toString())}">View incident episode in OneUptime</a>`,
      );
    }

    lines.push(
      "",
      `✅ <a href="${this.escapeTelegramHtml(ackUrl.toString())}">Tap to acknowledge</a>`,
    );

    return lines.join("\n");
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
  public async generateWhatsAppTemplateForIncidentEpisodeCreated(
    to: Phone,
    incidentEpisode: IncidentEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<WhatsAppMessage> {
    const acknowledgeUrl: URL = await this.buildOnCallAcknowledgeShortUrl(
      userOnCallLogTimelineId,
    );

    const episodeLinkOnDashboard: string =
      incidentEpisode.projectId && incidentEpisode.id
        ? (
            await IncidentEpisodeService.getEpisodeLinkInDashboard(
              incidentEpisode.projectId,
              incidentEpisode.id,
            )
          ).toString()
        : acknowledgeUrl.toString();

    const templateKey: WhatsAppTemplateId =
      WhatsAppTemplateIds.IncidentEpisodeCreated;
    const templateVariables: Record<string, string> = {
      project_name: incidentEpisode.project?.name || "OneUptime",
      episode_title: incidentEpisode.title || "",
      acknowledge_url: acknowledgeUrl.toString(),
      episode_number:
        incidentEpisode.episodeNumberWithPrefix ||
        (incidentEpisode.episodeNumber !== undefined
          ? incidentEpisode.episodeNumber.toString()
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

    const alertNumber: string =
      alert.alertNumberWithPrefix ||
      (alert.alertNumber ? `#${alert.alertNumber}` : "");

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

    const incidentNumber: string =
      incident.incidentNumberWithPrefix ||
      (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

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
              alertNumberWithPrefix: true,
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
        const alertNumber: string =
          alert.alertNumberWithPrefix ||
          (alert.alertNumber ? `#${alert.alertNumber}` : "");
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

    const episodeNumber: string =
      alertEpisode.episodeNumberWithPrefix ||
      (alertEpisode.episodeNumber ? `#${alertEpisode.episodeNumber}` : "");

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
  public async generateEmailTemplateForIncidentEpisodeCreated(
    to: Email,
    incidentEpisode: IncidentEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<EmailMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    // Fetch incidents that are members of this episode
    const episodeMembers: Array<IncidentEpisodeMember> =
      await IncidentEpisodeMemberService.findBy({
        query: {
          incidentEpisodeId: incidentEpisode.id!,
        },
        select: {
          incidentId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    // Get the incident IDs
    const incidentIds: Array<ObjectID> = episodeMembers
      .map((member: IncidentEpisodeMember) => {
        return member.incidentId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return id !== undefined;
      });

    // Fetch full incident data with monitors
    const incidents: Array<Incident> =
      incidentIds.length > 0
        ? await IncidentService.findBy({
            query: {
              _id: QueryHelper.any(incidentIds),
            },
            select: {
              _id: true,
              title: true,
              incidentNumber: true,
              incidentNumberWithPrefix: true,
              monitors: {
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

    /*
     * Unique monitors across every incident in the episode. An incident carries
     * a list of monitors (unlike an alert, which has exactly one), so this
     * flattens rather than reading a single relation.
     */
    const monitorNames: Set<string> = new Set();
    for (const incident of incidents) {
      for (const monitor of incident.monitors || []) {
        if (monitor.name) {
          monitorNames.add(monitor.name);
        }
      }
    }

    const resourcesAffected: string =
      monitorNames.size > 0
        ? Array.from(monitorNames).join(", ")
        : "No resources identified";

    // Build incidents list HTML with proper email styling
    let incidentsListHtml: string = "";
    if (incidents.length > 0) {
      const incidentRows: string[] = [];
      for (const incident of incidents) {
        const incidentTitle: string = incident.title || "Untitled Incident";
        const incidentNumber: string =
          incident.incidentNumberWithPrefix ||
          (incident.incidentNumber ? `#${incident.incidentNumber}` : "");
        const incidentLink: string = (
          await IncidentService.getIncidentLinkInDashboard(
            incidentEpisode.projectId!,
            incident.id!,
          )
        ).toString();
        const monitorName: string =
          (incident.monitors || [])
            .map((monitor: Monitor): string => {
              return monitor.name || "";
            })
            .filter((name: string): boolean => {
              return name.length > 0;
            })
            .join(", ") || "";

        incidentRows.push(`
            <tr>
              <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0;">
                <table cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="vertical-align: middle;">
                      <span style="display: inline-block; background-color: #fee2e2; color: #991b1b; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; margin-right: 8px;">${incidentNumber}</span>
                      <a href="${incidentLink}" style="color: #2563eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; font-weight: 500; text-decoration: none;">${incidentTitle}</a>
                      ${monitorName ? `<span style="display: block; color: #64748b; font-size: 12px; margin-top: 4px;">Monitor: ${monitorName}</span>` : ""}
                    </td>
                    <td style="text-align: right; vertical-align: middle;">
                      <a href="${incidentLink}" style="color: #2563eb; font-size: 12px; text-decoration: none;">View →</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          `);
      }
      if (incidentRows.length > 0) {
        incidentsListHtml = `
          <table cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 8px; border: 1px solid #e2e8f0; margin: 8px 0 16px 0;">
            <tbody>
              ${incidentRows.join("")}
            </tbody>
          </table>
        `;
      }
    }

    const episodeNumber: string =
      incidentEpisode.episodeNumberWithPrefix ||
      (incidentEpisode.episodeNumber
        ? `#${incidentEpisode.episodeNumber}`
        : "");

    const vars: Dictionary<string> = {
      incidentEpisodeTitle: incidentEpisode.title!,
      episodeNumber: episodeNumber,
      projectName: incidentEpisode.project!.name!,
      currentState: incidentEpisode.currentIncidentState!.name!,
      incidentEpisodeDescription: await Markdown.convertToHTML(
        incidentEpisode.description! || "",
        MarkdownContentType.Email,
      ),
      incidentEpisodeSeverity: incidentEpisode.incidentSeverity!.name!,
      resourcesAffected: resourcesAffected,
      rootCause:
        incidentEpisode.rootCause ||
        "No root cause identified for this incident episode",
      incidentsList: incidentsListHtml,
      incidentsCount: incidents.length.toString(),
      incidentEpisodeViewLink: (
        await IncidentEpisodeService.getEpisodeLinkInDashboard(
          incidentEpisode.projectId!,
          incidentEpisode.id!,
        )
      ).toString(),
      acknowledgeIncidentEpisodeLink: new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ).toString(),
    };

    const emailMessage: EmailMessage = {
      toEmail: to!,
      templateType: EmailTemplateType.AcknowledgeIncidentEpisode,
      vars: vars,
      subject: `ACTION REQUIRED: Incident Episode ${episodeNumber} created - ${incidentEpisode.title!}`,
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
      logger.error(error, {
        projectId: options.projectId?.toString(),
        userId: userId?.toString(),
      } as LogAttributes);
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
      logger.error(error, {
        projectId: data.projectId?.toString(),
        userId: data.userId?.toString(),
      } as LogAttributes);
    });
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const hasNotificationMethod: boolean = Boolean(
      createBy.data.userCallId ||
        createBy.data.userCall ||
        createBy.data.userEmail ||
        createBy.data.userSms ||
        createBy.data.userSmsId ||
        createBy.data.userWhatsApp ||
        createBy.data.userWhatsAppId ||
        createBy.data.userTelegram ||
        createBy.data.userTelegramId ||
        createBy.data.userWebhook ||
        createBy.data.userWebhookId ||
        createBy.data.userEmailId ||
        createBy.data.userPushId ||
        createBy.data.userPush,
    );

    /*
     * An opt-out row is how a user says "deliberately do not page me for this
     * rule type at this severity". It carries the rule type and the severity and
     * nothing else — a method on it would be self-contradictory (reach me here;
     * also never reach me), and its whole purpose is to make silence explicit so
     * that every OTHER zero-rule case can be treated as misconfiguration and
     * rescued by the fallback.
     */
    if (createBy.data.isOptOut) {
      if (hasNotificationMethod) {
        throw new BadDataException(
          "An opt-out notification rule cannot have a notification method. Remove the notification method, or turn off opt-out.",
        );
      }

      return {
        createBy,
        carryForward: null,
      };
    }

    if (!hasNotificationMethod) {
      throw new BadDataException(
        "Call, SMS, WhatsApp, Telegram, Webhook, Email, or Push notification is required",
      );
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  public async addDefaultNotificationRulesForVerifiedMethod(data: {
    projectId: ObjectID;
    userId: ObjectID;
    notificationMethod: NotificationMethodDescriptor;
  }): Promise<void> {
    const { projectId, userId, notificationMethod } = data;

    /*
     * Read each severity list once and reuse it for both rule types it drives.
     * Incident severities scope both ON_CALL_EXECUTED_INCIDENT and
     * ON_CALL_EXECUTED_INCIDENT_EPISODE; alert severities do the same for their
     * two.
     */
    const incidentSeverityIds: Array<ObjectID> =
      await this.getIncidentSeverityIds(projectId);
    const alertSeverityIds: Array<ObjectID> =
      await this.getAlertSeverityIds(projectId);

    await this.createSeverityScopedRules({
      projectId,
      userId,
      notificationMethod,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      severityIds: incidentSeverityIds,
      severityColumn: "incidentSeverityId",
    });

    await this.createSeverityScopedRules({
      projectId,
      userId,
      notificationMethod,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      severityIds: alertSeverityIds,
      severityColumn: "alertSeverityId",
    });

    /*
     * The two episode rule types are severity-scoped as well, and used not to
     * be. UserOnCallLogService counts episode rules filtered by a concrete
     * severity id, and the episode rule pages in User Settings scope their
     * tables the same way — so a NULL-severity episode rule matched no page and
     * appeared in no table. Users got "defaults" that were unreachable and
     * invisible at the same time.
     */
    await this.createSeverityScopedRules({
      projectId,
      userId,
      notificationMethod,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      severityIds: alertSeverityIds,
      severityColumn: "alertSeverityId",
    });

    await this.createSeverityScopedRules({
      projectId,
      userId,
      notificationMethod,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      severityIds: incidentSeverityIds,
      severityColumn: "incidentSeverityId",
    });

    /*
     * These two are about the user's shift, not about anything that fired, so
     * they legitimately have no severity and stay single rules.
     */
    await this.createSingleRule(
      projectId,
      userId,
      notificationMethod,
      NotificationRuleType.WHEN_USER_GOES_ON_CALL,
    );
    await this.createSingleRule(
      projectId,
      userId,
      notificationMethod,
      NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
    );
  }

  private applyNotificationMethod(
    rule: Model,
    descriptor: NotificationMethodDescriptor,
  ): void {
    if (descriptor.userEmailId) {
      rule.userEmailId = descriptor.userEmailId;
    }
    if (descriptor.userSmsId) {
      rule.userSmsId = descriptor.userSmsId;
    }
    if (descriptor.userCallId) {
      rule.userCallId = descriptor.userCallId;
    }
    if (descriptor.userWhatsAppId) {
      rule.userWhatsAppId = descriptor.userWhatsAppId;
    }
    if (descriptor.userTelegramId) {
      rule.userTelegramId = descriptor.userTelegramId;
    }
    if (descriptor.userWebhookId) {
      rule.userWebhookId = descriptor.userWebhookId;
    }
    if (descriptor.userPushId) {
      rule.userPushId = descriptor.userPushId;
    }
  }

  private getNotificationMethodQuery(
    descriptor: NotificationMethodDescriptor,
  ): Record<string, ObjectID> {
    const query: Record<string, ObjectID> = {};
    if (descriptor.userEmailId) {
      query["userEmailId"] = descriptor.userEmailId;
    }
    if (descriptor.userSmsId) {
      query["userSmsId"] = descriptor.userSmsId;
    }
    if (descriptor.userCallId) {
      query["userCallId"] = descriptor.userCallId;
    }
    if (descriptor.userWhatsAppId) {
      query["userWhatsAppId"] = descriptor.userWhatsAppId;
    }
    if (descriptor.userTelegramId) {
      query["userTelegramId"] = descriptor.userTelegramId;
    }
    if (descriptor.userWebhookId) {
      query["userWebhookId"] = descriptor.userWebhookId;
    }
    if (descriptor.userPushId) {
      query["userPushId"] = descriptor.userPushId;
    }
    return query;
  }

  private async getIncidentSeverityIds(
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
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

    return incidentSeverities.map((severity: IncidentSeverity): ObjectID => {
      return severity.id!;
    });
  }

  private async getAlertSeverityIds(
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
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

    return alertSeverities.map((severity: AlertSeverity): ObjectID => {
      return severity.id!;
    });
  }

  /*
   * Seed one rule per severity for a severity-scoped rule type, skipping any
   * (method, severity, ruleType) triple the user already has. The duplicate
   * check is keyed on the same columns the write sets, so re-verifying a method
   * never doubles a user's rules — and therefore never doubles their pages.
   */
  private async createSeverityScopedRules(data: {
    projectId: ObjectID;
    userId: ObjectID;
    notificationMethod: NotificationMethodDescriptor;
    ruleType: NotificationRuleType;
    severityIds: Array<ObjectID>;
    severityColumn: "incidentSeverityId" | "alertSeverityId";
  }): Promise<void> {
    for (const severityId of data.severityIds) {
      const existingRule: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          userId: data.userId,
          ...this.getNotificationMethodQuery(data.notificationMethod),
          [data.severityColumn]: severityId,
          ruleType: data.ruleType,
        } as any,
        props: {
          isRoot: true,
        },
      });

      if (existingRule) {
        continue;
      }

      const rule: Model = new Model();
      rule.projectId = data.projectId;
      rule.userId = data.userId;
      this.applyNotificationMethod(rule, data.notificationMethod);
      rule[data.severityColumn] = severityId;
      rule.notifyAfterMinutes = 0;
      rule.ruleType = data.ruleType;

      await this.create({
        data: rule,
        props: {
          isRoot: true,
        },
      });
    }
  }

  private async createSingleRule(
    projectId: ObjectID,
    userId: ObjectID,
    notificationMethod: NotificationMethodDescriptor,
    ruleType: NotificationRuleType,
  ): Promise<void> {
    const existingRule: Model | null = await this.findOneBy({
      query: {
        projectId,
        userId,
        ...this.getNotificationMethodQuery(notificationMethod),
        ruleType,
      } as any,
      props: {
        isRoot: true,
      },
    });

    if (existingRule) {
      return;
    }

    const rule: Model = new Model();
    rule.projectId = projectId;
    rule.userId = userId;
    this.applyNotificationMethod(rule, notificationMethod);
    rule.notifyAfterMinutes = 0;
    rule.ruleType = ruleType;

    await this.create({
      data: rule,
      props: {
        isRoot: true,
      },
    });
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

    await this.addDefaultNotificationRulesForVerifiedMethod({
      projectId,
      userId,
      notificationMethod: {
        userEmailId: userEmail.id!,
      },
    });
  }
}
export default new Service();
