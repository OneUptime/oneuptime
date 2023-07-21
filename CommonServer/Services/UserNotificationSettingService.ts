import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import PositiveNumber from 'Common/Types/PositiveNumber';
import ObjectID from 'Common/Types/ObjectID';
import NotificationSettingEventType from 'Common/Types/NotificationSetting/NotificationSettingEventType';
import UserNotificationSetting from 'Model/Models/UserNotificationSetting';
import TeamMemberService from './TeamMemberService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import { SMSMessage } from 'Common/Types/SMS/SMS';
import { CallRequestMessage } from 'Common/Types/Call/CallRequest';
import MailService from './MailService';
import UserEmail from 'Model/Models/UserEmail';
import UserEmailService from './UserEmailService';
import { EmailEnvelope } from 'Common/Types/Email/EmailMessage';
import logger from '../Utils/Logger';
import UserSMS from 'Model/Models/UserSMS';
import SmsService from './SmsService';
import UserSmsService from './UserSmsService';
import UserCallService from './UserCallService';
import CallService from './CallService';

export class Service extends DatabaseService<UserNotificationSetting> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(UserNotificationSetting, postgresDatabase);
    }


    public async sendUserNotification(data: {userId: ObjectID, projectId: ObjectID, eventType: NotificationSettingEventType, emailEnvelope: EmailEnvelope, smsMessage: SMSMessage, callRequestMessage: CallRequestMessage}): Promise<void> {
        const notificationSettings: UserNotificationSetting | null = await this.findOneBy({
            query: {
                userId: data.userId,
                projectId: data.projectId,
                eventType: data.eventType,
            },
            select: {
                alertByEmail: true,
                alertBySMS: true,
                alertByCall: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (notificationSettings) {
            if (notificationSettings.alertByEmail) {

                // get all the emails of the user. 
                const userEmails: Array<UserEmail> = await UserEmailService.findBy({
                    query: {
                        userId: data.userId,
                        projectId:  data.projectId,
                        isVerified: true,
                    },
                    select: {
                        email: true,
                    },
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    props: {
                        isRoot: true,
                    }
                });

                for (const userEmail of userEmails) {
                    MailService.sendMail({
                        ...data.email,
                        toEmail: userEmail.email!,
                    }, undefined, {
                        projectId: data.projectId,
                    }).catch((err: Error) => {
                        logger.error(err);
                    });
                }
            }

            if (notificationSettings.alertBySMS) {
                const userSmses: Array<UserSMS> = await UserSmsService.findBy({
                    query: {

                        userId: data.userId,
                        projectId: data.projectId,
                        isVerified: true,
                    },
                    select: {
                        phone: true,
                    },
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    props: {
                        isRoot: true,
                    }
                });

                for (const userSms of userSmses) {
                    SmsService.sendSms({
                        ...data.sms,
                        to: userSms.phone!,
                    }, {
                        projectId: data.projectId,
                    }).catch((err: Error) => {
                        logger.error(err);
                    });
                }
            }

            if (notificationSettings.alertByCall) {
                const userCalls = await UserCallService.findBy({
                    query: {
                        userId: data.userId,
                        projectId: data.projectId,
                        isVerified: true,
                    },
                    select: {
                        phone: true,
                    },
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    props: {
                        isRoot: true,
                    }
                });

                for (const userCall of userCalls) {
                    CallService.makeCall({
                        ...data.call,
                        to: userCall.phone!,
                    }, {
                        projectId: data.projectId,
                    }).catch((err: Error) => {
                        logger.error(err);
                    });
                }

            }
        }
    }

    public async removeDefaultNotificationSettingsForUser(
        userId: ObjectID,
        projectId: ObjectID
    ): Promise<void> {
        // check if this user is not in the project anymore.
        const count: PositiveNumber = await TeamMemberService.countBy({
            query: {
                projectId,
                userId,
                hasAcceptedInvitation: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (count.toNumber() === 0) {
            await this.deleteBy({
                query: {
                    projectId,
                    userId,
                },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });
        }
    }

    public async addDefaultNotificationSettingsForUser(
        userId: ObjectID,
        projectId: ObjectID
    ): Promise<void> {
        const incidentCreatedNotificationEvent: PositiveNumber =
            await this.countBy({
                query: {
                    userId,
                    projectId,
                    eventType:
                        NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
                },
                props: {
                    isRoot: true,
                },
            });

        if (incidentCreatedNotificationEvent.toNumber() === 0) {
            const item: UserNotificationSetting = new UserNotificationSetting();
            item.userId = userId;
            item.projectId = projectId;
            item.eventType =
                NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;
            item.alertByEmail = true;

            await this.create({
                data: item,
                props: {
                    isRoot: true,
                },
            });
        }

        // check monitor state changed notification
        const monitorStateChangedNotificationEvent: PositiveNumber =
            await this.countBy({
                query: {
                    userId,
                    projectId,
                    eventType:
                        NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION,
                },
                props: {
                    isRoot: true,
                },
            });

        if (monitorStateChangedNotificationEvent.toNumber() === 0) {
            const item: UserNotificationSetting = new UserNotificationSetting();
            item.userId = userId;
            item.projectId = projectId;
            item.eventType =
                NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION;
            item.alertByEmail = true;

            await this.create({
                data: item,
                props: {
                    isRoot: true,
                },
            });
        }

        // check incident state changed notification
        const incidentStateChangedNotificationEvent: PositiveNumber =
            await this.countBy({
                query: {
                    userId,
                    projectId,
                    eventType:
                        NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
                },
                props: {
                    isRoot: true,
                },
            });

        if (incidentStateChangedNotificationEvent.toNumber() === 0) {
            const item: UserNotificationSetting = new UserNotificationSetting();
            item.userId = userId;
            item.projectId = projectId;
            item.eventType =
                NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION;
            item.alertByEmail = true;

            await this.create({
                data: item,
                props: {
                    isRoot: true,
                },
            });
        }
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<UserNotificationSetting>
    ): Promise<OnCreate<UserNotificationSetting>> {
        // check if the same event for same user is added.
        if (!createBy.data.projectId) {
            throw new BadDataException(
                'ProjectId is required for UserNotificationSetting'
            );
        }

        if (!createBy.data.userId) {
            throw new BadDataException(
                'UserId is required for UserNotificationSetting'
            );
        }

        if (!createBy.data.eventType) {
            throw new BadDataException(
                'EventType is required for UserNotificationSetting'
            );
        }

        const count: PositiveNumber = await this.countBy({
            query: {
                projectId: createBy.data.projectId,
                userId: createBy.data.userId,
                eventType: createBy.data.eventType,
            },
            props: {
                isRoot: true,
            },
        });

        if (count.toNumber() > 0) {
            throw new BadDataException(
                'Notification Setting of the same event type already exists for the user.'
            );
        }

        return {
            createBy,
            carryForward: undefined,
        };
    }
}

export default new Service();
