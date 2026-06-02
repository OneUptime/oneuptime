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
import SmsStatus from "Common/Types/SmsStatus";
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
import logger from "Common/Server/Utils/Logger";
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
    },
  ): Promise<void> {
    const startNs: bigint = process.hrtime.bigint();
    let outcome: "success" | "failure" = "success";

    try {
      await this.sendSmsInternal(to, message, options);
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
    },
  ): Promise<void> {
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

      smsLog.smsText =
        options && options.isSensitive
          ? "This message is sensitive and is not logged"
          : message;
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
        throw new BadDataException("Twilio Config not found");
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
          return;
        }

        if (!project.enableSmsNotifications) {
          smsLog.status = SmsStatus.Error;
          smsLog.statusMessage = `SMS notifications are not enabled for this project. Please enable SMS notifications in Project Settings.`;
          logger.error(smsLog.statusMessage);
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
              `We tried to send an SMS to ${to.toString()} with message: <br/> <br/> ${message} <br/> <br/> This SMS was not sent because SMS notifications are not enabled for this project. Please enable SMS notifications in Project Settings.`,
            );
          }
          return;
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

          if (!project.smsOrCallCurrentBalanceInUSDCents) {
            smsLog.status = SmsStatus.LowBalance;
            smsLog.statusMessage = `Project ${options.projectId.toString()} does not have enough SMS balance.`;
            logger.error(smsLog.statusMessage);
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
                `We tried to send an SMS to ${to.toString()} with message: <br/> <br/> ${message} <br/>This SMS was not sent because project does not have enough balance to send SMS. Current balance is ${
                  (project.smsOrCallCurrentBalanceInUSDCents || 0) / 100
                } USD cents. Required balance to send this SMS should is ${smsCost} USD. Please enable auto recharge or recharge manually.`,
              );
            }
            return;
          }

          if (project.smsOrCallCurrentBalanceInUSDCents < smsCost * 100) {
            smsLog.status = SmsStatus.LowBalance;
            smsLog.statusMessage = `Project does not have enough balance to send SMS. Current balance is ${
              project.smsOrCallCurrentBalanceInUSDCents / 100
            } USD. Required balance is ${smsCost} USD to send this SMS.`;
            logger.error(smsLog.statusMessage);
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
                `We tried to send an SMS to ${to.toString()} with message: <br/> <br/> ${message} <br/> <br/> This SMS was not sent because project does not have enough balance to send SMS. Current balance is ${
                  project.smsOrCallCurrentBalanceInUSDCents / 100
                } USD. Required balance is ${smsCost} USD to send this SMS. Please enable auto recharge or recharge manually.`,
              );
            }
            return;
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
        // Row was inserted before the send — persist the resulting state.
        await SmsLogService.updateOneById({
          id: smsLogId,
          data: {
            status: smsLog.status!,
            statusMessage: smsLog.statusMessage!,
            smsCostInUSDCents: smsLog.smsCostInUSDCents!,
            ...(smsLog.errorCode ? { errorCode: smsLog.errorCode } : {}),
          },
          props: {
            isRoot: true,
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
