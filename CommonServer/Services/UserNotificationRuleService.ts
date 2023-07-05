import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserNotificationRule';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import Email from 'Common/Types/Email';
import IncidentSeverityService from './IncidentSeverityService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import UserEmailService from './UserEmailService';
import UserEmail from 'Model/Models/UserEmail';
import NotificationRuleType from 'Common/Types/NotificationRule/NotificationRuleType';
import UserNotificationEventType from 'Common/Types/UserNotification/UserNotificationEventType';
import UserNotificationLog from 'Model/Models/UserNotificationLog';
import UserNotificationLogService from './UserNotificationLogService';
import UserNotificationLogTimeline from 'Model/Models/UserNotificationLogTimeline';
import UserNotificationStatus from 'Common/Types/UserNotification/UserNotificationStatus';
import CallRequest from 'Common/Types/Call/CallRequest';
import EmailMessage from 'Common/Types/Email/EmailMessage';
import SMS from 'Common/Types/SMS/SMS';
import Incident from 'Model/Models/Incident';
import URL from 'Common/Types/API/URL';
import { DashboardApiRoute, Domain, HttpProtocol } from '../Config';
import ShortLinkService from './ShortLinkService';
import ShortLink from 'Model/Models/ShortLink';
import Phone from 'Common/Types/Phone';
import Dictionary from 'Common/Types/Dictionary';
import Markdown from '../Types/Markdown';
import IncidentService from './IncidentService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import UserNotificationLogTimelineService from './UserNotificationLogTimelineService';
import MailService from './MailService';
import SmsService from './SmsService';
import CallService from './CallService';
import OneUptimeDate from 'Common/Types/Date';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async executeNotificationRuleItem(
        userNotificationRuleId: ObjectID,
        options: {
            projectId: ObjectID;
            triggeredByIncidentId?: ObjectID | undefined;
            userNotificationEventType: UserNotificationEventType;
            onCallPolicyExecutionLogId?: ObjectID | undefined;
            onCallPolicyId: ObjectID | undefined;
            onCallPolicyEscalationRuleId?: ObjectID | undefined;
            userNotificationLogId: ObjectID;
            userBelongsToTeamId?: ObjectID | undefined;
            onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
        }
    ): Promise<void> {
        // get user notifcation log and see if this rule has already been executed. If so then skip.

        const userNotificationLog: UserNotificationLog | null =
            await UserNotificationLogService.findOneById({
                id: options.userNotificationLogId,
                props: {
                    isRoot: true,
                },
                select: {
                    _id: true,
                    executedNotificationRules: true,
                },
            });

        if (!userNotificationLog) {
            throw new BadDataException('User notification log not found.');
        }

        if (
            Object.keys(
                userNotificationLog.executedNotificationRules || {}
            ).includes(userNotificationRuleId.toString())
        ) {
            // already executed.
            return;
        }

        if (!userNotificationLog.executedNotificationRules) {
            userNotificationLog.executedNotificationRules = {};
        }

        userNotificationLog.executedNotificationRules[
            userNotificationRuleId.toString()
        ] = OneUptimeDate.getCurrentDate();

        await UserNotificationLogService.updateOneById({
            id: userNotificationLog.id!,
            data: {
                executedNotificationRules: {
                    ...userNotificationLog.executedNotificationRules,
                },
            } as any,
            props: {
                isRoot: true,
            },
        });

        const logTimelineItem: UserNotificationLogTimeline =
            new UserNotificationLogTimeline();
        logTimelineItem.projectId = options.projectId;
        logTimelineItem.userNotificationLogId = options.userNotificationLogId;
        logTimelineItem.userNotificationRuleId = userNotificationRuleId;
        logTimelineItem.userNotificationLogId = options.userNotificationLogId;
        logTimelineItem.userNotificationEventType =
            options.userNotificationEventType;

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
            logTimelineItem.triggeredByIncidentId =
                options.triggeredByIncidentId;
        }

        if (options.onCallDutyPolicyExecutionLogTimelineId) {
            logTimelineItem.onCallDutyPolicyExecutionLogTimelineId =
                options.onCallDutyPolicyExecutionLogTimelineId;
        }

        // add status and status message and save.

        // find notification rule item.
        const notificationRuleItem: Model | null = await this.findOneById({
            id: userNotificationRuleId!,
            select: {
                _id: true,
                userCall: {
                    phone: true,
                    isVerified: true,
                },
                userSms: {
                    phone: true,
                    isVerified: true,
                },
                userEmail: {
                    email: true,
                    isVerified: true,
                },
            },
            props: {
                isRoot: true,
            },
        });

        if (!notificationRuleItem) {
            throw new BadDataException('Notification rule item not found.');
        }

        let incident: Incident | null = null;

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
                },
            });
        }

        if (!incident) {
            throw new BadDataException('Incident not found.');
        }

        if (
            notificationRuleItem.userEmail?.email &&
            notificationRuleItem.userEmail?.isVerified
        ) {
            // send email.
            if (
                options.userNotificationEventType ===
                    UserNotificationEventType.IncidentCreated &&
                incident
            ) {
                // create an error log.
                logTimelineItem.status = UserNotificationStatus.Sending;
                logTimelineItem.statusMessage = `Sending email to ${notificationRuleItem.userEmail?.email.toString()}`;

                const updatedLog: UserNotificationLogTimeline =
                    await UserNotificationLogTimelineService.create({
                        data: logTimelineItem,
                        props: {
                            isRoot: true,
                        },
                    });

                const emailMessage: EmailMessage =
                    await this.generateEmailTemplateForIncidentCreated(
                        notificationRuleItem.userEmail?.email,
                        incident,
                        updatedLog.id!
                    );

                // send email.

                MailService.sendMail(emailMessage, undefined, {
                    userNotificationLogTimelineId: updatedLog.id!,
                }).catch(async (err: Error) => {
                    await UserNotificationLogTimelineService.updateOneById({
                        id: updatedLog.id!,
                        data: {
                            status: UserNotificationStatus.Error,
                            statusMessage:
                                err.message || 'Error sending email.',
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

            await UserNotificationLogTimelineService.create({
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
            // send sms.
            if (
                options.userNotificationEventType ===
                    UserNotificationEventType.IncidentCreated &&
                incident
            ) {
                // create an error log.
                logTimelineItem.status = UserNotificationStatus.Sending;
                logTimelineItem.statusMessage = `Sending SMS to ${notificationRuleItem.userSms?.phone.toString()}.`;

                const updatedLog: UserNotificationLogTimeline =
                    await UserNotificationLogTimelineService.create({
                        data: logTimelineItem,
                        props: {
                            isRoot: true,
                        },
                    });

                const smsMessage: SMS =
                    await this.generateSmsTemplateForIncidentCreated(
                        notificationRuleItem.userSms?.phone!,
                        incident,
                        updatedLog.id!
                    );

                // send email.

                SmsService.sendSms(smsMessage, {
                    projectId: incident.projectId,
                    userNotificationLogTimelineId: updatedLog.id!,
                }).catch(async (err: Error) => {
                    await UserNotificationLogTimelineService.updateOneById({
                        id: updatedLog.id!,
                        data: {
                            status: UserNotificationStatus.Error,
                            statusMessage: err.message || 'Error sending SMS.',
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

            await UserNotificationLogTimelineService.create({
                data: logTimelineItem,
                props: {
                    isRoot: true,
                },
            });
        }

        // send call.
        if (
            notificationRuleItem.userCall?.phone &&
            notificationRuleItem.userCall?.isVerified
        ) {
            // send call.
            logTimelineItem.status = UserNotificationStatus.Sending;
            logTimelineItem.statusMessage = `Making a call to ${notificationRuleItem.userCall?.phone.toString()}.`;

            const updatedLog: UserNotificationLogTimeline =
                await UserNotificationLogTimelineService.create({
                    data: logTimelineItem,
                    props: {
                        isRoot: true,
                    },
                });

            const callRequest: CallRequest =
                await this.generateCallTemplateForIncidentCreated(
                    notificationRuleItem.userCall?.phone!,
                    incident,
                    updatedLog.id!
                );

            // send email.

            CallService.makeCall(callRequest, {
                projectId: incident.projectId,
                userNotificationLogTimelineId: updatedLog.id!,
            }).catch(async (err: Error) => {
                await UserNotificationLogTimelineService.updateOneById({
                    id: updatedLog.id!,
                    data: {
                        status: UserNotificationStatus.Error,
                        statusMessage: err.message || 'Error making call.',
                    },
                    props: {
                        isRoot: true,
                    },
                });
            });
        }

        if (
            notificationRuleItem.userCall?.phone &&
            !notificationRuleItem.userCall?.isVerified
        ) {
            // create a log.
            logTimelineItem.status = UserNotificationStatus.Error;
            logTimelineItem.statusMessage = `Call not sent because phone ${notificationRuleItem.userCall?.phone.toString()} is not verified.`;

            await UserNotificationLogTimelineService.create({
                data: logTimelineItem,
                props: {
                    isRoot: true,
                },
            });
        }
    }

    public async generateCallTemplateForIncidentCreated(
        to: Phone,
        incident: Incident,
        userNotificationLogTimelineId: ObjectID
    ): Promise<CallRequest> {
        const callRequest: CallRequest = {
            to: to,
            data: [
                {
                    sayMessage: 'This is a call from OneUptime',
                },
                {
                    sayMessage: 'A new incident has been created',
                },
                {
                    sayMessage: incident.title!,
                },
                {
                    introMessage: 'To acknowledge this incident press 1',
                    numDigits: 1,
                    timeoutInSeconds: 10,
                    noInputMessage: 'You have not entered any input. Good bye',
                    onInputCallRequest: {
                        '1': {
                            sayMessage:
                                'You have acknowledged this incident. Good bye',
                        },
                        default: {
                            sayMessage: 'Invalid input. Good bye',
                        },
                    },
                    responseUrl: new URL(
                        HttpProtocol,
                        Domain,
                        DashboardApiRoute.addRoute(
                            new UserNotificationLogTimeline().crudApiPath!
                        ).addRoute(
                            '/call/gather-input/' +
                                userNotificationLogTimelineId.toString()
                        )
                    ),
                },
            ],
        };

        return callRequest;
    }

    public async generateSmsTemplateForIncidentCreated(
        to: Phone,
        incident: Incident,
        userNotificationLogTimelineId: ObjectID
    ): Promise<SMS> {
        const shortUrl: ShortLink = await ShortLinkService.saveShortLinkFor(
            new URL(
                HttpProtocol,
                Domain,
                DashboardApiRoute.addRoute(
                    new UserNotificationLogTimeline().crudApiPath!
                ).addRoute(
                    '/acknowledge/' + userNotificationLogTimelineId.toString()
                )
            )
        );
        const url: URL = ShortLinkService.getShortenedUrl(shortUrl);

        const sms: SMS = {
            to,
            message: `This is a message from OneUptime. A new incident has been created. ${
                incident.title
            }. To acknowledge this incident, please click on the following link ${url.toString()}`,
        };

        return sms;
    }

    public async generateEmailTemplateForIncidentCreated(
        to: Email,
        incident: Incident,
        userNotificationLogTimelineId: ObjectID
    ): Promise<EmailMessage> {
        const vars: Dictionary<string> = {
            incidentTitle: incident.title!,
            projectName: incident.project!.name!,
            currentState: incident.currentIncidentState!.name!,
            incidentDescription: Markdown.convertToHTML(
                incident.description! || ''
            ),
            incidentSeverity: incident.incidentSeverity!.name!,
            rootCause:
                incident.rootCause ||
                'No root cause identified for this incident',
            incidentViewLink: IncidentService.getIncidentLinkInDashboard(
                incident.projectId!,
                incident.id!
            ).toString(),
            acknowledgeIncidentLink: new URL(
                HttpProtocol,
                Domain,
                DashboardApiRoute.addRoute(
                    new UserNotificationLogTimeline().crudApiPath!
                ).addRoute(
                    '/acknowledge/' + userNotificationLogTimelineId.toString()
                )
            ).toString(),
        };

        const emailMessage: EmailMessage = {
            toEmail: to!,
            templateType: EmailTemplateType.AcknowledgeIncident,
            vars: vars,
            subject: 'ACTION REQUIRED: Incident created - ' + incident.title!,
        };

        return emailMessage;
    }

    public async startUserNotificationRulesExecution(
        userId: ObjectID,
        options: {
            projectId: ObjectID;
            triggeredByIncidentId?: ObjectID | undefined;
            userNotificationEventType: UserNotificationEventType;
            onCallPolicyExecutionLogId?: ObjectID | undefined;
            onCallPolicyId: ObjectID | undefined;
            onCallPolicyEscalationRuleId?: ObjectID | undefined;
            userBelongsToTeamId?: ObjectID | undefined;
            onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
        }
    ): Promise<void> {
        // add user notification log.
        const userNotificationLog: UserNotificationLog =
            new UserNotificationLog();

        userNotificationLog.userId = userId;
        userNotificationLog.projectId = options.projectId;

        if (options.triggeredByIncidentId) {
            userNotificationLog.triggeredByIncidentId =
                options.triggeredByIncidentId;
        }

        userNotificationLog.userNotificationEventType =
            options.userNotificationEventType;

        if (options.onCallPolicyExecutionLogId) {
            userNotificationLog.onCallDutyPolicyId =
                options.onCallPolicyExecutionLogId;
        }

        if (options.onCallPolicyId) {
            userNotificationLog.onCallDutyPolicyId = options.onCallPolicyId;
        }

        if (options.onCallDutyPolicyExecutionLogTimelineId) {
            userNotificationLog.onCallDutyPolicyExecutionLogTimelineId =
                options.onCallDutyPolicyExecutionLogTimelineId;
        }

        if (options.onCallPolicyEscalationRuleId) {
            userNotificationLog.onCallDutyPolicyEscalationRuleId =
                options.onCallPolicyEscalationRuleId;
        }

        if (options.userBelongsToTeamId) {
            userNotificationLog.userBelongsToTeamId =
                options.userBelongsToTeamId;
        }

        await UserNotificationLogService.create({
            data: userNotificationLog,
            props: {
                isRoot: true,
            },
        });
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (
            !createBy.data.userCallId &&
            !createBy.data.userCall &&
            !createBy.data.userEmail &&
            !createBy.data.userSms &&
            !createBy.data.userSmsId &&
            !createBy.data.userEmailId
        ) {
            throw new BadDataException('Call, SMS, or Email is required');
        }

        return {
            createBy,
            carryForward: null,
        };
    }

    public async addDefaultNotifictionRuleForUser(
        projectId: ObjectID,
        userId: ObjectID,
        email: Email
    ): Promise<void> {
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

        //check userEmail

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

        // create for incident severities.
        for (const incidentSeverity of incidentSeverities) {
            //check if this rule already exists.
            const existingRule: Model | null = await this.findOneBy({
                query: {
                    projectId,
                    userId,
                    userEmailId: userEmail.id!,
                    incidentSeverityId: incidentSeverity.id!,
                    ruleType: NotificationRuleType.ON_CALL_INCIDENT_CREATED,
                },
                props: {
                    isRoot: true,
                },
            });

            if (existingRule) {
                continue; // skip this rule.
            }

            const notificationRule: Model = new Model();

            notificationRule.projectId = projectId;
            notificationRule.userId = userId;
            notificationRule.userEmailId = userEmail.id!;
            notificationRule.incidentSeverityId = incidentSeverity.id!;
            notificationRule.notifyAfterMinutes = 0;
            notificationRule.ruleType =
                NotificationRuleType.ON_CALL_INCIDENT_CREATED;

            await this.create({
                data: notificationRule,
                props: {
                    isRoot: true,
                },
            });
        }

        //check if this rule already exists.
        const existingRuleOnCall: Model | null = await this.findOneBy({
            query: {
                projectId,
                userId,
                userEmailId: userEmail.id!,
                ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
            },
            props: {
                isRoot: true,
            },
        });

        if (!existingRuleOnCall) {
            // on and off call.
            const onCallRule: Model = new Model();

            onCallRule.projectId = projectId;
            onCallRule.userId = userId;
            onCallRule.userEmailId = userEmail.id!;
            onCallRule.notifyAfterMinutes = 0;
            onCallRule.ruleType = NotificationRuleType.WHEN_USER_GOES_ON_CALL;

            await this.create({
                data: onCallRule,
                props: {
                    isRoot: true,
                },
            });
        }

        //check if this rule already exists.
        const existingRuleOffCall: Model | null = await this.findOneBy({
            query: {
                projectId,
                userId,
                userEmailId: userEmail.id!,
                ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
            },
            props: {
                isRoot: true,
            },
        });

        if (!existingRuleOffCall) {
            // on and off call.
            const offCallRule: Model = new Model();

            offCallRule.projectId = projectId;
            offCallRule.userId = userId;
            offCallRule.userEmailId = userEmail.id!;
            offCallRule.notifyAfterMinutes = 0;
            offCallRule.ruleType = NotificationRuleType.WHEN_USER_GOES_OFF_CALL;

            await this.create({
                data: offCallRule,
                props: {
                    isRoot: true,
                },
            });
        }
    }
}
export default new Service();
