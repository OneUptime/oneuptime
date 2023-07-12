import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserNotificationLog';
import DatabaseService, { OnCreate, OnUpdate } from './DatabaseService';
import UserNotificationRule from 'Model/Models/UserNotificationRule';
import UserNotificationRuleService from './UserNotificationRuleService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import NotificationRuleType from 'Common/Types/NotificationRule/NotificationRuleType';
import UserNotificationEventType from 'Common/Types/UserNotification/UserNotificationEventType';
import BadDataException from 'Common/Types/Exception/BadDataException';
import CreateBy from '../Types/Database/CreateBy';
import UserNotificationExecutionStatus from 'Common/Types/UserNotification/UserNotificationExecutionStatus';
import IncidentService from './IncidentService';
import Incident from 'Model/Models/Incident';
import PositiveNumber from 'Common/Types/PositiveNumber';
import ObjectID from 'Common/Types/ObjectID';
import OnCallDutyPolicyExecutionLogTimelineService from './OnCallDutyPolicyExecutionLogTimelineService';
import OnCallDutyExecutionLogTimelineStatus from 'Common/Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus';

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

    protected override async onUpdateSuccess(
        onUpdate: OnUpdate<Model>,
        _updatedItemIds: ObjectID[]
    ): Promise<OnUpdate<Model>> {
        if (onUpdate.updateBy.data.status) {
            //update the correspomnding oncallTimeline.
            const items: Array<Model> = await this.findBy({
                query: onUpdate.updateBy.query,
                select: {
                    onCallDutyPolicyExecutionLogTimelineId: true,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

            let status: OnCallDutyExecutionLogTimelineStatus | undefined =
                undefined;

            switch (onUpdate.updateBy.data.status) {
                case UserNotificationExecutionStatus.Completed:
                    status =
                        OnCallDutyExecutionLogTimelineStatus.NotificationSent;
                    break;
                case UserNotificationExecutionStatus.Error:
                    status = OnCallDutyExecutionLogTimelineStatus.Error;
                    break;
                case UserNotificationExecutionStatus.Executing:
                    status = OnCallDutyExecutionLogTimelineStatus.Executing;
                    break;
                case UserNotificationExecutionStatus.Scheduled:
                    status = OnCallDutyExecutionLogTimelineStatus.Started;
                    break;
                case UserNotificationExecutionStatus.Started:
                    status = OnCallDutyExecutionLogTimelineStatus.Started;
                    break;
                default:
                    throw new BadDataException('Invalid status');
            }

            for (const item of items) {
                await OnCallDutyPolicyExecutionLogTimelineService.updateOneById(
                    {
                        id: item.onCallDutyPolicyExecutionLogTimelineId!,
                        data: {
                            status: status!,
                            statusMessage:
                                onUpdate.updateBy.data.statusMessage!,
                        },
                        props: {
                            isRoot: true,
                        },
                    }
                );
            }
        }

        return onUpdate;
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

        const incident: Incident | null = await IncidentService.findOneById({
            id: createdItem.triggeredByIncidentId!,
            props: {
                isRoot: true,
            },
            select: {
                incidentSeverityId: true,
            },
        });

        // Check if there are any rules .
        const ruleCount: PositiveNumber =
            await UserNotificationRuleService.countBy({
                query: {
                    userId: createdItem.userId!,
                    projectId: createdItem.projectId!,
                    ruleType: notificationRuleType,
                    incidentSeverityId: incident?.incidentSeverityId!,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

        if (ruleCount.toNumber() === 0) {
            // update this item to be processed.
            await this.updateOneById({
                id: createdItem.id!,
                data: {
                    status: UserNotificationExecutionStatus.Error, // now the worker will pick this up and complete this or mark this as failed.
                    statusMessage:
                        'No notification rules found. Please add rules in User Settings > On Call Rules.',
                },
                props: {
                    isRoot: true,
                },
            });

            // update oncall timeline item as well.
            await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
                id: createdItem.onCallDutyPolicyExecutionLogTimelineId!,
                data: {
                    status: OnCallDutyExecutionLogTimelineStatus.Error,
                    statusMessage:
                        'No notification rules found. Please add rules in User Settings > On Call Rules.',
                },
                props: {
                    isRoot: true,
                },
            });

            return createdItem;
        }

        // find immediate notification rule and alert the user.
        const immediateNotificationRule: Array<UserNotificationRule> =
            await UserNotificationRuleService.findBy({
                query: {
                    userId: createdItem.userId!,
                    projectId: createdItem.projectId!,
                    notifyAfterMinutes: 0,
                    ruleType: notificationRuleType,
                    incidentSeverityId: incident?.incidentSeverityId!,
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
                status: UserNotificationExecutionStatus.Executing, // now the worker will pick this up and complete this or mark this as failed.
            },
            props: {
                isRoot: true,
            },
        });

        // update oncall timeline item as well.
        await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
            id: createdItem.onCallDutyPolicyExecutionLogTimelineId!,
            data: {
                status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
                statusMessage: 'Initial notification sent to the user.',
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
