import {
  SMSDefaultCostInCents,
  SMSHighRiskCostInCents,
  getTwilioConfig,
} from "../Config";
import { isHighRiskPhoneNumber } from "Common/Types/Call/CallRequest";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SafeHtml from "Common/Types/SafeHtml";
import SmsStatus from "Common/Types/SmsStatus";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import Text from "Common/Types/Text";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import {
  Host,
  HttpProtocol,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import ProjectNotificationChannelOwnerNotice from "Common/Server/Utils/ProjectNotificationChannelOwnerNotice";
import ProjectBalanceOwnerNotice from "Common/Server/Utils/ProjectBalanceOwnerNotice";
import {
  getProjectNotificationChannelOffMessage,
  ProjectNotificationChannel,
} from "Common/Utils/Project/NotificationChannels";
import {
  getProjectBalanceMessageNotSentReason,
  getProjectBalanceShortfallSentence,
  ProjectBalanceType,
} from "Common/Utils/Project/ProjectBalance";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import Twilio from "twilio";
import { MessageInstance } from "twilio/lib/rest/api/v2010/account/message";

export default class SmsService {
  public static async sendSms(
    to: Phone,
    message: string,
    options: {
      projectId?: ObjectID | undefined; // project id for sms log
      customTwilioConfig?: TwilioConfig | undefined;
      isSensitive?: boolean; // if true, message will not be logged
      userOnCallLogTimelineId?: ObjectID | undefined;
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
      monitorId?: ObjectID | undefined;
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
      /*
       * Throw when the SMS is deliberately not sent - the project was not
       * found, has SMS notifications turned off, or has too little balance -
       * instead of returning as if it went out. The SMS log and the owners'
       * email are written either way. Status page subscriber sends that count
       * what they delivered pass it, so such an SMS counts as failed, not
       * sent; everyone else keeps the quiet return.
       */
      failIfNotSent?: boolean | undefined;
    },
  ): Promise<void> {
    const startNs: bigint = process.hrtime.bigint();
    let outcome: "success" | "failure" = "success";

    try {
      const notSentReason: string | null = await this.sendSmsInternal(
        to,
        message,
        options,
      );

      if (notSentReason !== null && options.failIfNotSent) {
        // The tenant's settings or balance, not a defect: a user error.
        throw new BadDataException(
          `SMS not sent: ${notSentReason}`,
        ).asUserError();
      }
    } catch (err) {
      outcome = "failure";
      throw err;
    } finally {
      const elapsedNs: bigint = process.hrtime.bigint() - startNs;
      const durationMs: number = Number(elapsedNs) / 1e6;
      const attributes: Record<string, string> = {
        "notification.channel": "sms",
        outcome,
      };

      AppMetrics.getNotificationCounter().add(1, attributes);
      AppMetrics.getNotificationDuration().record(durationMs, attributes);
    }
  }

  private static async sendSmsInternal(
    to: Phone,
    message: string,
    options: {
      projectId?: ObjectID | undefined; // project id for sms log
      customTwilioConfig?: TwilioConfig | undefined;
      isSensitive?: boolean; // if true, message will not be logged
      userOnCallLogTimelineId?: ObjectID | undefined;
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
      monitorId?: ObjectID | undefined;
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
      failIfNotSent?: boolean | undefined;
    },
  ): Promise<string | null> {
    /*
     * Returns why the SMS was deliberately not sent (the project was not
     * found, has SMS turned off, or has too little balance), after logging
     * it; null when it was handed to Twilio. A failure to send throws.
     */
    let smsError: Error | null = null;
    const smsLog: SmsLog = new SmsLog();
    /*
     * Set once the log row is persisted (before send) so the async delivery-status
     * callback has a row to update, and so the final state below is an update, not an insert.
     */
    let smsLogId: ObjectID | null = null;

    try {
      // check number of sms to send for this entire messages to send. Each sms can have 160 characters.
      const smsSegments: number = Math.ceil(message.length / 160);

      message = Text.trimLines(message);

      let smsCost: number = 0;

      const shouldChargeForSMS: boolean =
        IsBillingEnabled && !options.customTwilioConfig;

      if (shouldChargeForSMS) {
        smsCost = SMSDefaultCostInCents / 100;

        if (isHighRiskPhoneNumber(to)) {
          smsCost = SMSHighRiskCostInCents / 100;
        }
      }

      if (smsSegments > 1) {
        smsCost = smsCost * smsSegments;
      }

      smsLog.toNumber = to;

      /*
       * The copy of the message that is kept: the SMS log, and the owners'
       * email when it cannot be sent. Status page subscriber messages carry
       * the subscriber's unsubscribe link, whose token lets its holder cancel
       * the subscription without signing in - and the SMS log is readable by
       * project members who may not touch subscribers (Viewer, Read SMS Log).
       * So the token is kept out of every copy; only Twilio gets the message
       * as written.
       */
      const loggedMessage: string =
        StatusPageSubscriberUnsubscribe.redactCredentials(message);

      smsLog.smsText =
        options && options.isSensitive
          ? "This message is sensitive and is not logged"
          : loggedMessage;

      /*
       * The same copy as it goes into the owners' email - a sensitive one
       * (a verification code) stays out of it, as it stays out of the log -
       * whose message is placed as HTML: the text is plain - incident
       * titles, resource names, custom field values - so any markup in it is
       * shown, not rendered.
       */
      const loggedMessageHtml: string = SafeHtml.escape(smsLog.smsText);
      smsLog.smsCostInUSDCents = 0;

      if (options.projectId) {
        smsLog.projectId = options.projectId;
      }

      if (options.incidentId) {
        smsLog.incidentId = options.incidentId;
      }

      if (options.alertId) {
        smsLog.alertId = options.alertId;
      }

      if (options.monitorId) {
        smsLog.monitorId = options.monitorId;
      }

      if (options.scheduledMaintenanceId) {
        smsLog.scheduledMaintenanceId = options.scheduledMaintenanceId;
      }

      if (options.statusPageId) {
        smsLog.statusPageId = options.statusPageId;
      }

      if (options.statusPageAnnouncementId) {
        smsLog.statusPageAnnouncementId = options.statusPageAnnouncementId;
      }

      if (options.userId) {
        smsLog.userId = options.userId;
      }

      if (options.teamId) {
        smsLog.teamId = options.teamId;
      }

      // Set OnCall-related fields
      if (options.onCallPolicyId) {
        smsLog.onCallDutyPolicyId = options.onCallPolicyId;
      }

      if (options.onCallPolicyEscalationRuleId) {
        smsLog.onCallDutyPolicyEscalationRuleId =
          options.onCallPolicyEscalationRuleId;
      }

      if (options.onCallScheduleId) {
        smsLog.onCallDutyPolicyScheduleId = options.onCallScheduleId;
      }

      /*
       * Link the SMS to the on-call timeline entry so the delivery outcome can be
       * reflected back onto the on-call log via the status callback.
       */
      if (options.userOnCallLogTimelineId) {
        smsLog.userOnCallLogTimelineId = options.userOnCallLogTimelineId;
      }

      const twilioConfig: TwilioConfig | null =
        options.customTwilioConfig || (await getTwilioConfig());

      if (!twilioConfig) {
        /*
         * Nobody has filled in Twilio credentials in Global Settings (or the
         * caller passed a project-level config that is empty). Failing to send
         * is the correct behaviour, not a defect, so do not open an Issue.
         */
        throw new BadDataException("Twilio Config not found").asUserError();
      }

      const client: Twilio.Twilio = Twilio(
        twilioConfig.accountSid,
        twilioConfig.authToken,
      );

      const fromNumber: Phone = Phone.pickPhoneNumberToSendSMSOrCallFrom({
        to: to,
        primaryPhoneNumberToPickFrom: twilioConfig.primaryPhoneNumber,
        secondaryPhoneNumbersToPickFrom:
          twilioConfig.secondaryPhoneNumbers || [],
      });

      smsLog.fromNumber = fromNumber;

      let project: Project | null = null;

      // make sure project has enough balance.

      if (options.projectId) {
        project = await ProjectService.findOneById({
          id: options.projectId,
          select: {
            smsOrCallCurrentBalanceInUSDCents: true,
            enableSmsNotifications: true,
            lowCallAndSMSBalanceNotificationSentToOwners: true,
            name: true,
            notEnabledSmsOrCallNotificationSentToOwners: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (!project) {
          smsLog.status = SmsStatus.Error;
          smsLog.statusMessage = `Project ${options.projectId.toString()} not found.`;
          logger.error(smsLog.statusMessage);
          await SmsLogService.create({
            data: smsLog,
            props: {
              isRoot: true,
            },
          });
          return smsLog.statusMessage!;
        }

        if (!project.enableSmsNotifications) {
          smsLog.status = SmsStatus.Error;
          smsLog.statusMessage = getProjectNotificationChannelOffMessage(
            ProjectNotificationChannel.SMS,
          );
          // The project turned SMS off. Refusing to send is the setting working.
          logger.error(smsLog.statusMessage, EXTERNAL_FAULT);
          await SmsLogService.create({
            data: smsLog,
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
              "SMS notifications not enabled for " + (project.name || ""),
              `We tried to send an SMS to ${to.toString()} with message: <br/> <br/> ${loggedMessageHtml} <br/> <br/> This SMS was not sent. ${ProjectNotificationChannelOwnerNotice.getHtml(
                {
                  channel: ProjectNotificationChannel.SMS,
                  projectId: project.id!,
                },
              )}`,
            );
          }
          return smsLog.statusMessage!;
        }

        if (shouldChargeForSMS) {
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

          /*
           * Nothing left, or less than this SMS costs. The log (which the
           * project's members read, as they read a person's on-call
           * timeline) says who can add balance and where; the owners, who
           * may, are told to, with a link - once, until the balance is
           * topped up again (Utils/Project/ProjectBalance).
           */
          const balanceInUSDCents: number =
            project.smsOrCallCurrentBalanceInUSDCents || 0;

          if (!balanceInUSDCents || balanceInUSDCents < smsCost * 100) {
            const shortfall: {
              channel: ProjectNotificationChannel;
              balanceInUSDCents: number;
              costInUSDCents: number;
            } = {
              channel: ProjectNotificationChannel.SMS,
              balanceInUSDCents: balanceInUSDCents,
              costInUSDCents: Math.round(smsCost * 100),
            };

            smsLog.status = SmsStatus.LowBalance;
            smsLog.statusMessage =
              getProjectBalanceMessageNotSentReason(shortfall);
            // Tenant billing state, not a defect — the owners get emailed below.
            logger.error(smsLog.statusMessage, EXTERNAL_FAULT);
            await SmsLogService.create({
              data: smsLog,
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
                `We tried to send an SMS to ${to.toString()} with message: <br/> <br/> ${loggedMessageHtml} <br/> <br/> This SMS was not sent. ${SafeHtml.escape(
                  getProjectBalanceShortfallSentence(shortfall),
                )} ${ProjectBalanceOwnerNotice.getHtml({
                  balance: ProjectBalanceType.SmsOrCall,
                  projectId: project.id!,
                })}`,
              );
            }
            return smsLog.statusMessage!;
          }
        }
      }

      /*
       * Persist the log BEFORE sending so Twilio's asynchronous delivery-status
       * callback (which can arrive within milliseconds) has a row to update. The
       * row id plus an unguessable, never-exposed token authenticate the callback.
       * We only track delivery for project-scoped sends (which is when logs persist).
       */
      let statusCallbackUrl: string | undefined = undefined;

      if (options.projectId) {
        smsLog.status = SmsStatus.Sending;

        if (Host) {
          smsLog.statusCallbackToken = ObjectID.generate().toString();
        }

        const createdSmsLog: SmsLog = await SmsLogService.create({
          data: smsLog,
          props: {
            isRoot: true,
          },
        });
        smsLogId = createdSmsLog.id;

        if (Host && smsLogId && smsLog.statusCallbackToken) {
          /*
           * Nginx rewrites the external /notification path to /api/notification,
           * which is where the SMS router (and the /status-callback route) is mounted.
           */
          statusCallbackUrl = `${HttpProtocol}${Host}/notification/sms/status-callback/${smsLogId.toString()}/${smsLog.statusCallbackToken}`;
        }
      }

      const twillioMessage: MessageInstance = await client.messages.create({
        body: message,
        to: to.toString(),
        from: fromNumber.toString(), // From a valid Twilio number
        ...(statusCallbackUrl ? { statusCallback: statusCallbackUrl } : {}),
      });

      /*
       * messages.create resolves once Twilio accepts the message (typically status
       * "queued"/"accepted"). The terminal delivered/undelivered/failed state arrives
       * later via the status callback above.
       */
      smsLog.status =
        SmsService.mapProviderStatusToSmsStatus(twillioMessage.status) ||
        SmsStatus.Sent;
      smsLog.statusMessage = "Message ID: " + twillioMessage.sid;

      logger.debug("SMS message sent successfully.");
      logger.debug(smsLog.statusMessage);

      if (shouldChargeForSMS && project) {
        smsLog.smsCostInUSDCents = smsCost * 100;

        project.smsOrCallCurrentBalanceInUSDCents = Math.floor(
          project.smsOrCallCurrentBalanceInUSDCents! - smsCost * 100,
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
      smsLog.smsCostInUSDCents = 0;
      smsLog.status = SmsStatus.Error;
      smsLog.statusMessage =
        e && e.message ? e.message.toString() : e.toString();

      /*
       * Twilio SDK errors expose a numeric `code` (e.g. 21211). Surface it so
       * operators can see exactly why a send was rejected.
       */
      if (e && (e.code || e.code === 0)) {
        smsLog.errorCode = e.code.toString();
      }

      logger.error("SMS message failed to send.");
      logger.error(smsLog.statusMessage);

      smsError = e;
    }

    if (options.projectId) {
      if (smsLogId) {
        /*
         * Row was inserted before the send — persist the resulting state.
         * Runs once per SMS. SmsLog has update workflows disabled and no
         * audit/realtime decorators or service update hooks, so the full
         * update pipeline (re-SELECT + save transaction) is pure overhead —
         * a single hookless UPDATE is equivalent.
         */
        await SmsLogService.updateColumnsByIdWithoutHooks({
          id: smsLogId,
          data: {
            status: smsLog.status!,
            statusMessage: smsLog.statusMessage!,
            smsCostInUSDCents: smsLog.smsCostInUSDCents!,
            ...(smsLog.errorCode ? { errorCode: smsLog.errorCode } : {}),
          },
        });
      } else {
        // Send failed before the row could be inserted (e.g. missing Twilio config).
        await SmsLogService.create({
          data: smsLog,
          props: {
            isRoot: true,
          },
        });
      }
    }

    if (options.userOnCallLogTimelineId) {
      await UserOnCallLogTimelineService.updateOneById({
        data: {
          /*
           * Delivery is confirmed asynchronously via the status callback, so at this
           * point a successful submit is "Sending"/"Sent". Only the synchronous failure
           * states count as an error here.
           */
          status: SmsService.isFailureStatus(smsLog.status)
            ? UserNotificationStatus.Error
            : UserNotificationStatus.Sent,
          statusMessage: smsLog.statusMessage!,
        },
        id: options.userOnCallLogTimelineId,
        props: {
          isRoot: true,
        },
      });
    }

    if (smsError) {
      throw smsError;
    }

    return null;
  }

  /**
   * Maps a Twilio message status (from the create response or a status callback)
   * to our SmsStatus lifecycle. Returns null for statuses we don't track (e.g.
   * inbound "received"), so callers can keep the existing status.
   */
  public static mapProviderStatusToSmsStatus(
    providerStatus: string | undefined | null,
  ): SmsStatus | null {
    switch ((providerStatus || "").toLowerCase()) {
      case "queued":
      case "accepted":
      case "scheduled":
      case "sending":
        return SmsStatus.Sending;
      case "sent":
        return SmsStatus.Sent;
      case "delivered":
      case "partially_delivered":
        return SmsStatus.Delivered;
      case "undelivered":
        return SmsStatus.Undelivered;
      case "failed":
      case "canceled":
        return SmsStatus.Failed;
      default:
        return null;
    }
  }

  /**
   * Whether a status represents a definitive failure (as opposed to a pending or
   * successful state). Used to map SMS outcomes onto on-call notification status.
   */
  public static isFailureStatus(status: SmsStatus | undefined): boolean {
    return (
      status === SmsStatus.Error ||
      status === SmsStatus.Failed ||
      status === SmsStatus.Undelivered ||
      status === SmsStatus.LowBalance
    );
  }
}
