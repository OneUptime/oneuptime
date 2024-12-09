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
    },
  ): Promise<void> {
    let smsError: Error | null = null;
    const smsLog: SmsLog = new SmsLog();

    try {
      // Calculate the number of SMS segments, each SMS can contain 160 characters.
      const smsSegments: number = Math.ceil(message.length / 160);

      // Trim unnecessary lines from the message
      message = Text.trimLines(message);

      let smsCost: number = 0;

      // Determine if billing is enabled and no custom Twilio config is used
      const shouldChargeForSMS: boolean =
        IsBillingEnabled && !options.customTwilioConfig;

      if (shouldChargeForSMS) {
        smsCost = SMSDefaultCostInCents / 100;

        // Check if the phone number is high-risk, adjust cost accordingly
        if (isHighRiskPhoneNumber(to)) {
          smsCost = SMSHighRiskCostInCents / 100;
        }
      }

      // Multiply cost by the number of message segments if it exceeds one
      if (smsSegments > 1) {
        smsCost = smsCost * smsSegments;
      }

      const twilioConfig: TwilioConfig | null =
        options.customTwilioConfig || (await getTwilioConfig());

      // Check if Twilio configuration is available
      if (!twilioConfig) {
        throw new BadDataException("Twilio Config not found");
      }

      // Initialize Twilio client with account credentials
      const client: Twilio.Twilio = Twilio(
        twilioConfig.accountSid,
        twilioConfig.authToken,
      );

      // Set the sender phone number in the SMS log
      smsLog.fromNumber = twilioConfig.phoneNumber;

      let project: Project | null = null;

      // Ensure the project has sufficient balance for SMS notifications
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

        // Check if the specified project exists
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
          return; // Exit if project not found
        }

        // Verify if SMS notifications are enabled for the project
        if (!project.enableSmsNotifications) {
          smsLog.status = SmsStatus.Error;

          smsLog.statusMessage = `SMS notifications are not enabled for this project. Please enable SMS notifications in Project Settings.`;

          logger.error(smsLog.statusMessage);

          // Create an SMS log entry in the database
          await SmsLogService.create({
            data: smsLog,
            props: {
              isRoot: true,
            },
          });

          // Check if the notification about disabled SMS has not been sent to project owners
          if (!project.notEnabledSmsOrCallNotificationSentToOwners) {
            // Update the project to indicate the notification has been sent
            await ProjectService.updateOneById({
              data: {
                notEnabledSmsOrCallNotificationSentToOwners: true,
              },
              id: project.id!,
              props: {
                isRoot: true,
              },
            });

            // Send an email to project owners notifying them that SMS notifications are not enabled
            await ProjectService.sendEmailToProjectOwners(
              project.id!,
              "SMS notifications not enabled for " + (project.name || ""),
              `We tried to send an SMS to ${to.toString()} with message: <br/> <br/> ${message} <br/> <br/> This SMS was not sent because SMS notifications are not enabled for this project. Please enable SMS notifications in Project Settings.`,
            );
          }

          return;
        }

        // Check if SMS sending should incur a charge
        if (shouldChargeForSMS) {
          // Initialize updated balance with the current SMS or call balance
          let updatedBalance: number =
            project.smsOrCallCurrentBalanceInUSDCents!;
          try {
            updatedBalance = await NotificationService.rechargeIfBalanceIsLow(
              project.id!,
            );
          } catch (err) {
            // Log an error if recharging fails
            logger.error(err);
          }

          // Update the project's current balance with the new balance
          project.smsOrCallCurrentBalanceInUSDCents = updatedBalance;

          // Check if the updated balance is zero or undefined
          if (!project.smsOrCallCurrentBalanceInUSDCents) {
            // Set the SMS log status to indicate low balance
            smsLog.status = SmsStatus.LowBalance;
            // Log an error message indicating insufficient balance
            smsLog.statusMessage = `Project ${options.projectId.toString()} does not have enough SMS balance.`;
            logger.error(smsLog.statusMessage);

            // Create a log entry for the low balance situation
            await SmsLogService.create({
              data: smsLog,
              props: {
                isRoot: true,
              },
            });

            // Check if a low balance notification has been sent to project owners
            if (!project.lowCallAndSMSBalanceNotificationSentToOwners) {
              // Update the project to reflect that the notification has been sent
              await ProjectService.updateOneById({
                data: {
                  lowCallAndSMSBalanceNotificationSentToOwners: true,
                },
                id: project.id!,
                props: {
                  isRoot: true,
                },
              });

              // Send an email to project owners about the low balance
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
        from: twilioConfig.phoneNumber.toString(), // From a valid Twilio number
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
