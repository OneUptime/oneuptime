import ObjectID from 'Common/Types/ObjectID';
import Phone from 'Common/Types/Phone';
import {
    CallDefaultCostInCentsPerMinute,
    TwilioAccountSid,
    TwilioAuthToken,
    TwilioPhoneNumber,
} from '../Config';
import Twilio from 'twilio';
import TwilioUtil from '../Utils/Twilio';
import CallLog from 'Model/Models/CallLog';
import CallStatus from 'Common/Types/Call/CallStatus';
import CallRequest, { CallAction, Say } from 'Common/Types/Call/CallRequest';
import { IsBillingEnabled } from 'CommonServer/Config';
import CallLogService from 'CommonServer/Services/CallLogService';
import ProjectService from 'CommonServer/Services/ProjectService';
import Project from 'Model/Models/Project';
import NotificationService from 'CommonServer/Services/NotificationService';
import logger from 'CommonServer/Utils/Logger';
import { CallInstance } from 'twilio/lib/rest/api/v2010/account/call';


export default class CallService {
    public static async makeCall(
        to: Phone,
        callRequest: CallRequest,
        options: {
            projectId?: ObjectID | undefined; // project id for sms log
            from: Phone; // from phone number
            isSensitive?: boolean; // if true, message will not be logged
        }
    ): Promise<void> {

        TwilioUtil.checkEnvironmentVariables();

        const client: Twilio.Twilio = Twilio(TwilioAccountSid, TwilioAuthToken);

        const callLog: CallLog = new CallLog();
        callLog.toNumber = to;
        callLog.fromNumber = options.from || new Phone(TwilioPhoneNumber);
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

                if (!project) {
                    callLog.status = CallStatus.Error;
                    callLog.statusMessage = `Project ${options.projectId.toString()} not found.`;
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
                    callLog.statusMessage = `Call notifications are not enabled for this project. Please enable Call notifications in project settings.`;

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
                            'Call notifications not enabled for ' +
                            (project.name || ''),
                            `We tried to make a call to ${to.toString()}. <br/> <br/> This Call was not sent because call notifications are not enabled for this project. Please enable call notifications in project settings.`
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
                            `We tried to make a call to ${to.toString()}. This call was not made because project does not have enough balance to make calls. Current balance is ${(project.smsOrCallCurrentBalanceInUSDCents || 0) / 100
                            } USD. Required balance to send this SMS should is ${CallDefaultCostInCentsPerMinute / 100} USD. Please enable auto recharge or recharge manually.`
                        );
                    }
                    return;
                }

                if (
                    project.smsOrCallCurrentBalanceInUSDCents <
                    CallDefaultCostInCentsPerMinute
                ) {
                    callLog.status = CallStatus.LowBalance;
                    callLog.statusMessage = `Project does not have enough balance to make this call. Current balance is ${project.smsOrCallCurrentBalanceInUSDCents / 100} USD. Required balance is ${CallDefaultCostInCentsPerMinute / 100} USD to make this call.`;
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
                            `We tried to make a call to ${to.toString()}. This call was not made because project does not have enough balance to make a call. Current balance is ${project.smsOrCallCurrentBalanceInUSDCents / 100
                            } USD. Required balance is ${CallDefaultCostInCentsPerMinute / 100} USD to make this call. Please enable auto recharge or recharge manually.`
                        );
                    }
                    return;
                }
            }

            const twillioCall: CallInstance =
                await client.calls.create({
                    twiml: this.generateTwimlForCall(callRequest),
                    to: to.toString(),
                    from:
                        options && options.from
                            ? options.from.toString()
                            : TwilioPhoneNumber.toString(), // From a valid Twilio number
                });


            callLog.status = CallStatus.Success;
            callLog.statusMessage = 'Call ID: ' + twillioCall.sid;

            if (IsBillingEnabled && project) {
                callLog.callCostInUSDCents = CallDefaultCostInCentsPerMinute;

                if(twillioCall && parseInt(twillioCall.duration) > 60) {
                    callLog.callCostInUSDCents = Math.ceil(
                        (Math.ceil(parseInt(twillioCall.duration) / 60)) * CallDefaultCostInCentsPerMinute
                    );
                }

                project.smsOrCallCurrentBalanceInUSDCents = Math.floor(
                    project.smsOrCallCurrentBalanceInUSDCents! -
                    CallDefaultCostInCentsPerMinute
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
            callLog.callCostInUSDCents = 0;
            callLog.status = CallStatus.Error;
            callLog.statusMessage =
                e && e.message ? e.message.toString() : e.toString();
        }

        if (options.projectId) {
            await CallLogService.create({
                data: callLog,
                props: {
                    isRoot: true,
                },
            });
        }
    }

    public static generateTwimlForCall(callRequest: CallRequest): string {
        const response = new Twilio.twiml.VoiceResponse();

        for(const item of callRequest.data) {
            if((item as Say).sayMessage){
                response.say((item as Say).sayMessage);
            }

            if((item as CallAction) === CallAction.Hangup){
                response.hangup();
            }
        }

        return response.toString();
    }
}
