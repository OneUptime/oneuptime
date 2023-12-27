import ObjectID from 'Common/Types/ObjectID';
import Phone from 'Common/Types/Phone';
import {
    SMSDefaultCostInCents,
    SMSHighRiskCostInCents,
    getTwilioConfig,
} from '../Config';
import Twilio from 'twilio';
import SmsLog from 'Model/Models/SmsLog';
import SmsStatus from 'Common/Types/SmsStatus';
import { IsBillingEnabled } from 'CommonServer/EnvironmentConfig';
import SmsLogService from 'CommonServer/Services/SmsLogService';
import ProjectService from 'CommonServer/Services/ProjectService';
import Project from 'Model/Models/Project';
import { MessageInstance } from 'twilio/lib/rest/api/v2010/account/message';
import NotificationService from 'CommonServer/Services/NotificationService';
import logger from 'CommonServer/Utils/Logger';
import UserOnCallLogTimelineService from 'CommonServer/Services/UserOnCallLogTimelineService';
import UserNotificationStatus from 'Common/Types/UserNotification/UserNotificationStatus';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { isHighRiskPhoneNumber } from 'Common/Types/Call/CallRequest';
import Text from 'Common/Types/Text';
import TwilioConfig from 'Common/Types/CallAndSMS/TwilioConfig';

export default class SmsService {
    public static async sendSms(
        to: Phone,
        message: string,
        options: {
            projectId?: ObjectID | undefined; // project id for sms log
            customTwilioConfig?: TwilioConfig | undefined;
            isSensitive?: boolean; // if true, message will not be logged
            userOnCallLogTimelineId?: ObjectID | undefined;
        }
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

            const twilioConfig: TwilioConfig | null =
                options.customTwilioConfig || (await getTwilioConfig());

            if (!twilioConfig) {
                throw new BadDataException('Twilio Config not found');
            }

            const client: Twilio.Twilio = Twilio(
                twilioConfig.accountSid,
                twilioConfig.authToken
            );

            
            smsLog.toNumber = to;
            smsLog.fromNumber = twilioConfig.phoneNumber;
            smsLog.smsText =
                options && options.isSensitive
                    ? 'This message is sensitive and is not logged'
                    : message;
            smsLog.smsCostInUSDCents = 0;

            if (options.projectId) {
                smsLog.projectId = options.projectId;
            }

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
                            'SMS notifications not enabled for ' +
                            (project.name || ''),
                            `We tried to send an SMS to ${to.toString()} with message: <br/> <br/> ${message} <br/> <br/> This SMS was not sent because SMS notifications are not enabled for this project. Please enable SMS notifications in Project Settings.`
                        );
                    }
                    return;
                }

                if (shouldChargeForSMS) {
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
                        smsLog.status = SmsStatus.LowBalance;
                        smsLog.statusMessage = `Project ${options.projectId.toString()} does not have enough SMS balance.`;
                        logger.error(smsLog.statusMessage);
                        await SmsLogService.create({
                            data: smsLog,
                            props: {
                                isRoot: true,
                            },
                        });

                        if (
                            !project.lowCallAndSMSBalanceNotificationSentToOwners
                        ) {
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
                                `We tried to send an SMS to ${to.toString()} with message: <br/> <br/> ${message} <br/>This SMS was not sent because project does not have enough balance to send SMS. Current balance is ${(project.smsOrCallCurrentBalanceInUSDCents ||
                                    0) / 100
                                } USD cents. Required balance to send this SMS should is ${smsCost} USD. Please enable auto recharge or recharge manually.`
                            );
                        }
                        return;
                    }

                    if (
                        project.smsOrCallCurrentBalanceInUSDCents <
                        smsCost * 100
                    ) {
                        smsLog.status = SmsStatus.LowBalance;
                        smsLog.statusMessage = `Project does not have enough balance to send SMS. Current balance is ${project.smsOrCallCurrentBalanceInUSDCents / 100
                            } USD. Required balance is ${smsCost} USD to send this SMS.`;
                        logger.error(smsLog.statusMessage);
                        await SmsLogService.create({
                            data: smsLog,
                            props: {
                                isRoot: true,
                            },
                        });
                        if (
                            !project.lowCallAndSMSBalanceNotificationSentToOwners
                        ) {
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
                                `We tried to send an SMS to ${to.toString()} with message: <br/> <br/> ${message} <br/> <br/> This SMS was not sent because project does not have enough balance to send SMS. Current balance is ${project.smsOrCallCurrentBalanceInUSDCents /
                                100
                                } USD. Required balance is ${smsCost} USD to send this SMS. Please enable auto recharge or recharge manually.`
                            );
                        }
                        return;
                    }
                }
            }

            const twillioMessage: MessageInstance =
                await client.messages.create({
                    body: message,
                    to: to.toString(),
                    from: twilioConfig.phoneNumber.toString(), // From a valid Twilio number
                });

            smsLog.status = SmsStatus.Success;
            smsLog.statusMessage = 'Message ID: ' + twillioMessage.sid;

            logger.info('SMS message sent successfully.');
            logger.info(smsLog.statusMessage);

            if (shouldChargeForSMS && project) {
                smsLog.smsCostInUSDCents = smsCost * 100;

                project.smsOrCallCurrentBalanceInUSDCents = Math.floor(
                    project.smsOrCallCurrentBalanceInUSDCents! - smsCost * 100
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

            logger.error('SMS message failed to send.');
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
