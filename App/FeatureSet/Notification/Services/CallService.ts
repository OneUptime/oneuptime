import {
  CallDefaultCostInCentsPerMinute,
  CallHighRiskCostInCentsPerMinute,
  getTwilioConfig,
} from "../Config";
import CallRequest, {
  GatherInput,
  Say,
  isHighRiskPhoneNumber,
} from "Common/Types/Call/CallRequest";
import CallStatus from "Common/Types/Call/CallStatus";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import CallLogService from "Common/Server/Services/CallLogService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import logger from "Common/Server/Utils/Logger";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import Twilio from "twilio";
import { CallInstance } from "twilio/lib/rest/api/v2010/account/call";
import Phone from "Common/Types/Phone";

/**
 * Extracts the main sayMessage values from a CallRequest's data array for call summary.
 * Excludes acknowledgment responses, error messages, and other system messages.
 * @param callRequest The call request containing data array with various objects
 * @returns A string containing main call content messages separated by newlines
 */
function extractSayMessagesFromCallRequest(callRequest: CallRequest): string {
  const sayMessages: string[] = [];

  if (callRequest.data && Array.isArray(callRequest.data)) {
    for (const item of callRequest.data) {
      // Check if the item is a Say object with sayMessage
      if ((item as Say).sayMessage) {
        sayMessages.push((item as Say).sayMessage);
      }
      // Check if the item is a GatherInput with introMessage
      if ((item as GatherInput).introMessage) {
        sayMessages.push((item as GatherInput).introMessage);
      }
      /*
       * NOTE: Excluding noInputMessage and onInputCallRequest messages from summary
       * as they contain system responses like "Good bye", "Invalid input", "You have acknowledged"
       * which should not be included in the call summary according to user requirements
       */
    }
  }

  return sayMessages.length > 0
    ? sayMessages.join(" ")
    : "No message content found";
}

function sleep(time: number): Promise<void> {
  return new Promise((r: () => void) => {
    setTimeout(r, time);
  });
}


export default class CallService {
  public static async makeCall(
    callRequest: CallRequest,
    options: {
      projectId?: ObjectID | undefined; // project id for sms log
      isSensitive?: boolean; // if true, message will not be logged
      userOnCallLogTimelineId?: ObjectID | undefined; // user notification log timeline id
      customTwilioConfig?: TwilioConfig | undefined;
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
    let callError: Error | null = null;
    const callLog: CallLog = new CallLog();

    try {
      logger.debug("Call Request received.");

      let callCost: number = 0;

      // is no custom twilio config is provided, use default twilio config and charge for call.
      const shouldChargeForCall: boolean =
        IsBillingEnabled && !options.customTwilioConfig;

      if (shouldChargeForCall) {
        callCost = CallDefaultCostInCentsPerMinute / 100;
        if (isHighRiskPhoneNumber(callRequest.to)) {
          callCost = CallHighRiskCostInCentsPerMinute / 100;
        }
      }

      logger.debug("Call Cost: " + callCost);

      const twilioConfig: TwilioConfig | null =
        options.customTwilioConfig || (await getTwilioConfig());

      if (!twilioConfig) {
        throw new BadDataException("Twilio Config not found");
      }

      const client: Twilio.Twilio = Twilio(
        twilioConfig.accountSid,
        twilioConfig.authToken,
      );

      callLog.toNumber = callRequest.to;

      const fromNumber: Phone = Phone.pickPhoneNumberToSendSMSOrCallFrom({
        to: callRequest.to,
        primaryPhoneNumberToPickFrom: twilioConfig.primaryPhoneNumber,
        secondaryPhoneNumbersToPickFrom:
          twilioConfig.secondaryPhoneNumbers || [],
      });
      callLog.fromNumber = fromNumber;
      callLog.callData =
        options && options.isSensitive
          ? ({ message: "This call is sensitive and is not logged" } as any)
          : ({
              message: extractSayMessagesFromCallRequest(callRequest),
            } as any);
      callLog.callCostInUSDCents = 0;

      if (options.projectId) {
        callLog.projectId = options.projectId;
      }

      if (options.incidentId) {
        callLog.incidentId = options.incidentId;
      }

      if (options.alertId) {
        callLog.alertId = options.alertId;
      }

      if (options.monitorId) {
        callLog.monitorId = options.monitorId;
      }

      if (options.scheduledMaintenanceId) {
        callLog.scheduledMaintenanceId = options.scheduledMaintenanceId;
      }

      if (options.statusPageId) {
        callLog.statusPageId = options.statusPageId;
      }

      if (options.statusPageAnnouncementId) {
        callLog.statusPageAnnouncementId = options.statusPageAnnouncementId;
      }

      if (options.userId) {
        callLog.userId = options.userId;
      }

      if (options.teamId) {
        callLog.teamId = options.teamId;
      }

      // Set OnCall-related fields
      if (options.onCallPolicyId) {
        callLog.onCallDutyPolicyId = options.onCallPolicyId;
      }

      if (options.onCallPolicyEscalationRuleId) {
        callLog.onCallDutyPolicyEscalationRuleId =
          options.onCallPolicyEscalationRuleId;
      }

      if (options.onCallScheduleId) {
        callLog.onCallDutyPolicyScheduleId = options.onCallScheduleId;
      }

      let project: Project | null = null;

      // make sure project has enough balance.

      if (options.projectId) {
        project = await ProjectService.findOneById({
          id: options.projectId,
          select: {
            smsOrCallCurrentBalanceInUSDCents: true,
            enableCallNotifications: true,
            lowCallAndSMSBalanceNotificationSentToOwners: true,
            name: true,
            notEnabledSmsOrCallNotificationSentToOwners: true,
          },
          props: {
            isRoot: true,
          },
        });

        logger.debug("Project found.");

        if (!project) {
          callLog.status = CallStatus.Error;
          callLog.statusMessage = `Project ${options.projectId.toString()} not found.`;
          logger.error(callLog.statusMessage);
          await CallLogService.create({
            data: callLog,
            props: {
              isRoot: true,
            },
          });
          return;
        }

        if (!project.enableCallNotifications) {
          callLog.status = CallStatus.Error;
          callLog.statusMessage = `Call notifications are not enabled for this project. Please enable Call notifications in Project Settings.`;
          logger.error(callLog.statusMessage);
          await CallLogService.create({
            data: callLog,
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
              "Call notifications not enabled for " + (project.name || ""),
              `We tried to make a call to ${callRequest.to.toString()}. <br/> <br/> This Call was not sent because call notifications are not enabled for this project. Please enable call notifications in Project Settings.`,
            );
          }
          return;
        }

        if (shouldChargeForCall) {
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
            callLog.status = CallStatus.LowBalance;
            callLog.statusMessage = `Project ${options.projectId.toString()} does not have enough Call balance.`;
            logger.error(callLog.statusMessage);
            await CallLogService.create({
              data: callLog,
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
                `We tried to make a call to ${callRequest.to.toString()}. This call was not made because project does not have enough balance to make calls. Current balance is ${
                  (project.smsOrCallCurrentBalanceInUSDCents || 0) / 100
                } USD. Required balance to send this SMS should is ${callCost} USD. Please enable auto recharge or recharge manually.`,
              );
            }
            return;
          }

          if (project.smsOrCallCurrentBalanceInUSDCents < callCost * 100) {
            callLog.status = CallStatus.LowBalance;
            callLog.statusMessage = `Project does not have enough balance to make this call. Current balance is ${
              project.smsOrCallCurrentBalanceInUSDCents / 100
            } USD. Required balance is ${callCost} USD to make this call.`;
            logger.error(callLog.statusMessage);
            await CallLogService.create({
              data: callLog,
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
                `We tried to make a call to ${callRequest.to.toString()}. This call was not made because project does not have enough balance to make a call. Current balance is ${
                  project.smsOrCallCurrentBalanceInUSDCents / 100
                } USD. Required balance is ${callCost} USD to make this call. Please enable auto recharge or recharge manually.`,
              );
            }
            return;
          }
        }
      }

      logger.debug("Sending Call Request.");

      const twillioCall: CallInstance = await client.calls.create({
        twiml: this.generateTwimlForCall(callRequest),
        to: callRequest.to.toString(),
        from: fromNumber.toString(), // From a valid Twilio number
      });


      const callTimeout: number = 4 * 1e9;
      const callStart: bigint = process.hrtime.bigint();
      let callLifted: boolean = false;

      logger.debug("Call Request sent successfully.");

      callLog.status = CallStatus.Success;
      callLog.statusMessage = "Call ID: " + twillioCall.sid;

      logger.debug("Call ID: " + twillioCall.sid);
      logger.debug(callLog.statusMessage);

      const VERIFY_MSG = "Your verification code is";

      // the verificationCode must be allowed
      if(!callRequest.data.find(x => (x as Say).sayMessage?.indexOf(VERIFY_MSG) !== -1)) {
        while (process.hrtime.bigint() - callStart < callTimeout) {
          await sleep(500);
          const c: CallInstance = await client.calls.get(twillioCall.sid).fetch();
          if (c.status === "in-progress") {
            callLifted = true;
            break;
          }
        }

        // Drop the call after the timeout
        await client.calls
          .get(twillioCall.sid)
          .update({ status: "completed" })
          .catch(() => {});
      }

      // a call that wasn't lifted, is not getting charged
      // staff can be educated to setup a special ringtone for the
      // incoming number, to immediately note an incident and to
      // avoid lifting this number
      if (shouldChargeForCall && project && callLifted) {
        logger.debug("Updating Project Balance.");

        callLog.callCostInUSDCents = callCost * 100;

        if (twillioCall && parseInt(twillioCall.duration) > 60) {
          callLog.callCostInUSDCents = Math.ceil(
            Math.ceil(parseInt(twillioCall.duration) / 60) * (callCost * 100),
          );
        }

        logger.debug("Call Cost: " + callLog.callCostInUSDCents);

        project.smsOrCallCurrentBalanceInUSDCents = Math.floor(
          project.smsOrCallCurrentBalanceInUSDCents! - callCost * 100,
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

        logger.debug("Project's current balance updated.");
        logger.debug(
          "Current Balance: " + project.smsOrCallCurrentBalanceInUSDCents,
        );
      }
    } catch (e: any) {
      callLog.callCostInUSDCents = 0;
      callLog.status = CallStatus.Error;
      callLog.statusMessage =
        e && e.message ? e.message.toString() : e.toString();

      logger.error("Call Request failed.");
      logger.error(callLog.statusMessage);
      callError = e;
    }

    logger.debug("Saving Call Log if project id is provided.");

    if (options.projectId) {
      logger.debug("Saving Call Log.");
      await CallLogService.create({
        data: callLog,
        props: {
          isRoot: true,
        },
      });
      logger.debug("Call Log saved.");
    } else {
      logger.debug("Project Id is not provided. Call Log not saved.");
    }

    if (options.userOnCallLogTimelineId) {
      await UserOnCallLogTimelineService.updateOneById({
        data: {
          status:
            callLog.status === CallStatus.Success
              ? UserNotificationStatus.Sent
              : UserNotificationStatus.Error,
          statusMessage: callLog.statusMessage!,
        },
        id: options.userOnCallLogTimelineId,
        props: {
          isRoot: true,
        },
      });
    }

    if (callError) {
      throw callError;
    }
  }

  public static generateTwimlForCall(callRequest: CallRequest): string {
    const response: Twilio.twiml.VoiceResponse =
      new Twilio.twiml.VoiceResponse();

    for (const item of callRequest.data) {
      if ((item as Say).sayMessage) {
        response.say((item as Say).sayMessage);
      }

      if ((item as GatherInput) && (item as GatherInput).numDigits > 0) {
        response.say((item as GatherInput).introMessage);

        response.gather({
          numDigits: (item as GatherInput).numDigits,
          timeout: (item as GatherInput).timeoutInSeconds || 5,
          action: (item as GatherInput).responseUrl
            .addQueryParam(
              "token",
              JSONWebToken.signJsonPayload(
                JSONFunctions.serialize(
                  (item as GatherInput).onInputCallRequest as any,
                ),
                OneUptimeDate.getDayInSeconds(),
              ),
            )
            .toString(),
          method: "POST",
        });

        response.say((item as GatherInput).noInputMessage);
      }
    }

    response.hangup();

    return response.toString();
  }
}
