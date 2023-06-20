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

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
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
export default new Service();
