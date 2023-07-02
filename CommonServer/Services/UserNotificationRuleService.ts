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

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }


    public async executeNotificationRuleItem(userNotificationRuleId: ObjectID, options: {
        projectId: ObjectID;
        triggeredByIncidentId?: ObjectID | undefined;
        userNotificationEventType: UserNotificationEventType;
        onCallPolicyExecutionLogId?: ObjectID | undefined;
        onCallPolicyId: ObjectID | undefined;
        onCallPolicyEscalationRuleId?: ObjectID | undefined;
        userNotificationLogId: ObjectID;
        userBelongsToTeamId?: ObjectID | undefined;
    }): Promise<void> {

        // 

        const logTimelineItem: UserNotificationLogTimeline = new UserNotificationLogTimeline();
        logTimelineItem.projectId = options.projectId;
        logTimelineItem.userNotificationLogId = options.userNotificationLogId;
        logTimelineItem.userNotificationRuleId = userNotificationRuleId;
        logTimelineItem.userNotificationLogId = options.userNotificationLogId;
        logTimelineItem.userNotificationEventType = options.userNotificationEventType;

        if (options.userBelongsToTeamId) {
            logTimelineItem.userBelongsToTeamId = options.userBelongsToTeamId;
        }

        if (options.onCallPolicyId) {
            logTimelineItem.onCallDutyPolicyId = options.onCallPolicyId;
        }

        if (options.onCallPolicyEscalationRuleId) {
            logTimelineItem.onCallDutyPolicyEscalationRuleId = options.onCallPolicyEscalationRuleId;
        }

        if (options.onCallPolicyExecutionLogId) {
            logTimelineItem.onCallDutyPolicyExecutionLogId = options.onCallPolicyExecutionLogId;
        }

        if (options.triggeredByIncidentId) {
            logTimelineItem.triggeredByIncidentId = options.triggeredByIncidentId;
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
                }
            },
            props: {
                isRoot: true,
            },
        });

        if (!notificationRuleItem) {
            throw new BadDataException('Notification rule item not found.');
        }


        if (notificationRuleItem.userEmail?.email && notificationRuleItem.userEmail?.isVerified) {
            // send email. 
        }

        // if you have an email but is not verified, then create a log. 
        if (notificationRuleItem.userEmail?.email && !notificationRuleItem.userEmail?.isVerified) {
            // create an error log.
            logTimelineItem.status = UserNotificationStatus.Error;
            logTimelineItem.statusMessage = `Email notification not sent because email ${notificationRuleItem.userEmail?.email.toString()} is not verified.`;
        }

        // send sms.
        if (notificationRuleItem.userSms?.phone && notificationRuleItem.userSms?.isVerified) {
            // send sms. 
        }

        if (notificationRuleItem.userSms?.phone && !notificationRuleItem.userSms?.isVerified) {
            // create a log.
            logTimelineItem.status = UserNotificationStatus.Error;
            logTimelineItem.statusMessage = `SMS not sent because phone ${notificationRuleItem.userSms?.phone.toString()} is not verified.`;
        }

        // send call.
        if (notificationRuleItem.userCall?.phone && notificationRuleItem.userCall?.isVerified) {
            // send call. 
        }

        if (notificationRuleItem.userCall?.phone && !notificationRuleItem.userCall?.isVerified) {
            // create a log.
            logTimelineItem.status = UserNotificationStatus.Error;
            logTimelineItem.statusMessage = `Call not sent because phone ${notificationRuleItem.userCall?.phone.toString()} is not verified.`;
        }

    }

    public async generateCallTemplate(): Promise<CallRequest> {

    }

    public async generateSmsTemplate(): Promise<SMS> {
        
    }

    public async generateEmailTemplate(): Promise<EmailMessage> {
    
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
        }
    ): Promise<void> {

        // add user notification log. 
        const userNotificationLog: UserNotificationLog = new UserNotificationLog();

        userNotificationLog.userId = userId;
        userNotificationLog.projectId = options.projectId;
        if (options.triggeredByIncidentId) {
            userNotificationLog.triggeredByIncidentId = options.triggeredByIncidentId;
        }

        userNotificationLog.userNotificationEventType = options.userNotificationEventType;

        if (options.onCallPolicyExecutionLogId) {
            userNotificationLog.onCallDutyPolicyId = options.onCallPolicyExecutionLogId;
        }

        if (options.onCallPolicyId) {
            userNotificationLog.onCallDutyPolicyId = options.onCallPolicyId;
        }

        if (options.onCallPolicyEscalationRuleId) {
            userNotificationLog.onCallDutyPolicyEscalationRuleId =
                options.onCallPolicyEscalationRuleId;
        }

        if(options.userBelongsToTeamId){
            userNotificationLog.userBelongsToTeamId = options.userBelongsToTeamId;
        }


        await UserNotificationLogService.create({
            data: userNotificationLog,
            props: {
                isRoot: true
            }
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
