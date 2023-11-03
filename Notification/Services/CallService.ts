import ObjectID from 'Common/Types/ObjectID';
import Phone from 'Common/Types/Phone';
import {
    CallDefaultCostInCentsPerMinute,
    CallHighRiskCostInCentsPerMinute,
    TwilioConfig,
    getTwilioConfig,
} from '../Config';
import Twilio from 'twilio';
import CallLog from 'Model/Models/CallLog';
import CallStatus from 'Common/Types/Call/CallStatus';
import CallRequest, {
    GatherInput,
    Say,
    isHighRiskPhoneNumber,
} from 'Common/Types/Call/CallRequest';
import { IsBillingEnabled } from 'CommonServer/EnvironmentConfig';
import CallLogService from 'CommonServer/Services/CallLogService';
import ProjectService from 'CommonServer/Services/ProjectService';
import Project from 'Model/Models/Project';
import NotificationService from 'CommonServer/Services/NotificationService';
import logger from 'CommonServer/Utils/Logger';
import { CallInstance } from 'twilio/lib/rest/api/v2010/account/call';
import JSONWebToken from 'CommonServer/Utils/JsonWebToken';
import OneUptimeDate from 'Common/Types/Date';
import JSONFunctions from 'Common/Types/JSONFunctions';
import UserOnCallLogTimelineService from 'CommonServer/Services/UserOnCallLogTimelineService';
import UserNotificationStatus from 'Common/Types/UserNotification/UserNotificationStatus';
import BadDataException from 'Common/Types/Exception/BadDataException';

export default class CallService {
    public static async makeCall(
        callRequest: CallRequest,
        options: {
            projectId?: ObjectID | undefined; // project id for sms log
            from: Phone; // from phone number
            isSensitive?: boolean; // if true, message will not be logged
            userOnCallLogTimelineId?: ObjectID | undefined; // user notification log timeline id
        }
    ): Promise<void> {
        logger.info('Call Request received.');

        let callCost: number = 0;

        if (IsBillingEnabled) {
            callCost = CallDefaultCostInCentsPerMinute / 100;
            if (isHighRiskPhoneNumber(callRequest.to)) {
                callCost = CallHighRiskCostInCentsPerMinute / 100;
            }
        }

        logger.info('Call Cost: ' + callCost);

        const twilioConfig: TwilioConfig | null = await getTwilioConfig();

        if (!twilioConfig) {
            throw new BadDataException('Twilio Config not found');
        }

        const client: Twilio.Twilio = Twilio(
            twilioConfig.accountSid,
            twilioConfig.authToken
        );

        const callLog: CallLog = new CallLog();
        callLog.toNumber = callRequest.to;
        callLog.fromNumber = options.from || twilioConfig.phoneNumber;
        callLog.callData =
            options && options.isSensitive
                ? { message: 'This call is sensitive and is not logged' }
                : JSON.parse(JSON.stringify(callRequest));
        callLog.callCostInUSDCents = 0;

        if (options.projectId) {
            callLog.projectId = options.projectId;
        }

        let project: Project | null = null;

        try {
            // make sure project has enough balance.

            if (options.projectId && IsBillingEnabled) {
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

                logger.info('Project found.');

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
                                notEnabledSmsOrCallNotificationSentToOwners:
                                    true,
                            },
                            id: project.id!,
                            props: {
                                isRoot: true,
                            },
                        });
                        await ProjectService.sendEmailToProjectOwners(
                            project.id!,
                            'Call notifications not enabled for ' +
                                (project.name || ''),
                            `We tried to make a call to ${callRequest.to.toString()}. <br/> <br/> This Call was not sent because call notifications are not enabled for this project. Please enable call notifications in Project Settings.`
                        );
                    }
                    return;
                }

                // check if auto recharge is enabled and current balance is low.
                let updatedBalance: number =
                    project.smsOrCallCurrentBalanceInUSDCents!;
                try {
                    updatedBalance =
                        await NotificationService.rechargeIfBalanceIsLow(
                            project.id!
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
                                lowCallAndSMSBalanceNotificationSentToOwners:
                                    true,
                            },
                            id: project.id!,
                            props: {
                                isRoot: true,
                            },
                        });
                        await ProjectService.sendEmailToProjectOwners(
                            project.id!,
                            'Low SMS and Call Balance for ' +
                                (project.name || ''),
                            `We tried to make a call to ${callRequest.to.toString()}. This call was not made because project does not have enough balance to make calls. Current balance is ${
                                (project.smsOrCallCurrentBalanceInUSDCents ||
                                    0) / 100
                            } USD. Required balance to send this SMS should is ${callCost} USD. Please enable auto recharge or recharge manually.`
                        );
                    }
                    return;
                }

                if (
                    project.smsOrCallCurrentBalanceInUSDCents <
                    callCost * 100
                ) {
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
                                lowCallAndSMSBalanceNotificationSentToOwners:
                                    true,
                            },
                            id: project.id!,
                            props: {
                                isRoot: true,
                            },
                        });
                        await ProjectService.sendEmailToProjectOwners(
                            project.id!,
                            'Low SMS and Call Balance for ' +
                                (project.name || ''),
                            `We tried to make a call to ${callRequest.to.toString()}. This call was not made because project does not have enough balance to make a call. Current balance is ${
                                project.smsOrCallCurrentBalanceInUSDCents / 100
                            } USD. Required balance is ${callCost} USD to make this call. Please enable auto recharge or recharge manually.`
                        );
                    }
                    return;
                }
            }

            logger.info('Sending Call Request.');

            const twillioCall: CallInstance = await client.calls.create({
                twiml: this.generateTwimlForCall(callRequest),
                to: callRequest.to.toString(),
                from:
                    options && options.from
                        ? options.from.toString()
                        : twilioConfig.phoneNumber.toString(), // From a valid Twilio number
            });

            logger.info('Call Request sent successfully.');

            callLog.status = CallStatus.Success;
            callLog.statusMessage = 'Call ID: ' + twillioCall.sid;

            logger.info('Call ID: ' + twillioCall.sid);
            logger.info(callLog.statusMessage);

            if (IsBillingEnabled && project) {
                logger.info('Updating Project Balance.');

                callLog.callCostInUSDCents = callCost * 100;

                if (twillioCall && parseInt(twillioCall.duration) > 60) {
                    callLog.callCostInUSDCents = Math.ceil(
                        Math.ceil(parseInt(twillioCall.duration) / 60) *
                            (callCost * 100)
                    );
                }

                logger.info('Call Cost: ' + callLog.callCostInUSDCents);

                project.smsOrCallCurrentBalanceInUSDCents = Math.floor(
                    project.smsOrCallCurrentBalanceInUSDCents! - callCost * 100
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

                logger.info("Project's current balance updated.");
                logger.info(
                    'Current Balance: ' +
                        project.smsOrCallCurrentBalanceInUSDCents
                );
            }
        } catch (e: any) {
            callLog.callCostInUSDCents = 0;
            callLog.status = CallStatus.Error;
            callLog.statusMessage =
                e && e.message ? e.message.toString() : e.toString();

            logger.error('Call Request failed.');
            logger.error(callLog.statusMessage);
        }

        logger.info('Saving Call Log if project id is provided.');

        if (options.projectId) {
            logger.info('Saving Call Log.');
            await CallLogService.create({
                data: callLog,
                props: {
                    isRoot: true,
                },
            });
            logger.info('Call Log saved.');
        } else {
            logger.info('Project Id is not provided. Call Log not saved.');
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
                            'token',
                            JSONWebToken.signJsonPayload(
                                JSONFunctions.serialize(
                                    (item as GatherInput)
                                        .onInputCallRequest as any
                                ),
                                OneUptimeDate.getDayInSeconds()
                            )
                        )
                        .toString(),
                    method: 'POST',
                });

                response.say((item as GatherInput).noInputMessage);
            }
        }

        response.hangup();

        return response.toString();
    }
}
