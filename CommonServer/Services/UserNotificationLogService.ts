import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserNotificationLog';
import DatabaseService, { OnCreate } from './DatabaseService';
import UserNotificationRule from 'Model/Models/UserNotificationRule';
import UserNotificationRuleService from './UserNotificationRuleService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import NotificationRuleType from 'Common/Types/NotificationRule/NotificationRuleType';
import UserNotificationEventType from 'Common/Types/UserNotification/UserNotificationEventType';
import BadDataException from 'Common/Types/Exception/BadDataException';
import CreateBy from '../Types/Database/CreateBy';
import UserNotificationExecutionStatus from 'Common/Types/UserNotification/UserNotificationExecutionStatus';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        createBy.data.status = UserNotificationExecutionStatus.Scheduled;

        return {
            createBy,
            carryForward: null,
        };
    }

    protected override async onCreateSuccess(
        _onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        // update this item to be processed.
        await this.updateOneById({
            id: createdItem.id!,
            data: {
                status: UserNotificationExecutionStatus.Started,
            },
            props: {
                isRoot: true,
            },
        });

        const notificationRuleType: NotificationRuleType =
            this.getNotificationRuleType(
                createdItem.userNotificationEventType!
            );

        // find immediate notification rule and alert the user.
        const immediateNotificationRule: Array<UserNotificationRule> =
            await UserNotificationRuleService.findBy({
                query: {
                    userId: createdItem.userId!,
                    projectId: createdItem.projectId!,
                    notifyAfterMinutes: 0,
                    ruleType: notificationRuleType,
                },
                select: {
                    _id: true,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

        for (const immediateNotificationRuleItem of immediateNotificationRule) {
            await UserNotificationRuleService.executeNotificationRuleItem(
                immediateNotificationRuleItem.id!,
                {
                    userNotificationLogId: createdItem.id!,
                    projectId: createdItem.projectId!,
                    triggeredByIncidentId: createdItem.triggeredByIncidentId,
                    userNotificationEventType:
                        createdItem.userNotificationEventType!,
                    onCallPolicyExecutionLogId:
                        createdItem.onCallDutyPolicyExecutionLogId,
                    onCallPolicyId: createdItem.onCallDutyPolicyId,
                    onCallPolicyEscalationRuleId:
                        createdItem.onCallDutyPolicyEscalationRuleId,
                    userBelongsToTeamId: createdItem.userBelongsToTeamId,
                    onCallDutyPolicyExecutionLogTimelineId:
                        createdItem.onCallDutyPolicyExecutionLogTimelineId,
                }
            );
        }

        // update this item to be processed.
        await this.updateOneById({
            id: createdItem.id!,
            data: {
                status: UserNotificationExecutionStatus.Running, // now the worker will pick this up and complete this or mark this as failed.
            },
            props: {
                isRoot: true,
            },
        });

        return createdItem;
    }

    public getNotificationRuleType(
        userNotificationEventType: UserNotificationEventType
    ): NotificationRuleType {
        let notificationRuleType: NotificationRuleType =
            NotificationRuleType.ON_CALL_INCIDENT_CREATED;

        if (
            userNotificationEventType ===
            UserNotificationEventType.IncidentCreated
        ) {
            notificationRuleType =
                NotificationRuleType.ON_CALL_INCIDENT_CREATED;
        } else {
            // Invlaid user notification event type.
            throw new BadDataException('Invalid user notification event type.');
        }
        return notificationRuleType;
    }
}
export default new Service();
