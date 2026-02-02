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
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import logger from "Common/Server/Utils/Logger";
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
    let smsError: Error | null = null;
    const smsLog: SmsLog = new SmsLog();

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

      const twillioMessage: MessageInstance = await client.messages.create({
        body: message,
        to: to.toString(),
        from: fromNumber.toString(), // From a valid Twilio number
      });

      smsLog.status = SmsStatus.Success;
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

      logger.error("SMS message failed to send.");
      logger.error(smsLog.statusMessage);

      smsError = e;
    }

    if (options.projectId) {
      await SmsLogService.create({
        data: smsLog,
        props: {
          isRoot: true,
        },
      });
    }

    if (options.userOnCallLogTimelineId) {
      await UserOnCallLogTimelineService.updateOneById({
        data: {
          status:
            smsLog.status === SmsStatus.Success
              ? UserNotificationStatus.Sent
              : UserNotificationStatus.Error,
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
}
