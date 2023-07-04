import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserNotificationLogTimeline';
import DatabaseService, { OnUpdate } from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import UserNotificationLogService from './UserNotificationLogService';
import OnCallDutyPolicyExecutionLogService from './OnCallDutyPolicyExecutionLogService';
import OnCallDutyPolicyExecutionLogTimelineService from './OnCallDutyPolicyExecutionLogTimelineService';
import IncidentService from './IncidentService';
import UserNotificationExecutionStatus from 'Common/Types/UserNotification/UserNotificationExecutionStatus';
import OnCallDutyPolicyStatus from 'Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus';
import User from 'Model/Models/User';
import UserService from './UserService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import OnCallDutyExecutionLogTimelineStatus from 'Common/Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onUpdateSuccess(
        onUpdate: OnUpdate<Model>,
        _updatedItemIds: ObjectID[]
    ): Promise<OnUpdate<Model>> {
        if (
            onUpdate.updateBy.data.acknowledgedAt &&
            onUpdate.updateBy.data.isAcknowledged
        ) {
            const items: Array<Model> = await this.findBy({
                query: onUpdate.updateBy.query,
                select: {
                    _id: true,
                    projectId: true,
                    userId: true,
                    userNotificationLogId: true,
                    onCallDutyPolicyExecutionLogId: true,
                    triggeredByIncidentId: true,
                    onCallDutyPolicyExecutionLogTimelineId: true,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

            for (const item of items) {
                // this incident is acknowledged.

                // now we need to ack the parent log.

                const user: User | null = await UserService.findOneById({
                    id: item.userId!,
                    select: {
                        _id: true,
                        name: true,
                        email: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

                if (!user) {
                    throw new BadDataException('User not found.');
                }

                await UserNotificationLogService.updateOneById({
                    id: item.userNotificationLogId!,
                    data: {
                        acknowledgedAt: onUpdate.updateBy.data.acknowledgedAt,
                        acknowledgedByUserId: item.userId!,
                        status: UserNotificationExecutionStatus.Completed,
                        statusMessage:
                            'Incident acknowledged by ' +
                            user.name +
                            ' (' +
                            user.email +
                            ')',
                    },
                    props: {
                        isRoot: true,
                    },
                });

                //  and then oncall log.

                await OnCallDutyPolicyExecutionLogService.updateOneById({
                    id: item.onCallDutyPolicyExecutionLogId!,
                    data: {
                        acknowledgedAt: onUpdate.updateBy.data.acknowledgedAt,
                        acknowledgedByUserId: item.userId!,
                        status: OnCallDutyPolicyStatus.SuccessfullyAcknowledged,
                        statusMessage:
                            'Incident acknowledged by ' +
                            user.name +
                            ' (' +
                            user.email +
                            ')',
                    },
                    props: {
                        isRoot: true,
                    },
                });

                // and then oncall log timeline.
                await OnCallDutyPolicyExecutionLogTimelineService.updateOneById(
                    {
                        id: item.onCallDutyPolicyExecutionLogTimelineId!,
                        data: {
                            acknowledgedAt:
                                onUpdate.updateBy.data.acknowledgedAt,
                            isAcknowledged: true,
                            status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
                            statusMessage:
                                'Incident acknowledged by ' +
                                user.name +
                                ' (' +
                                user.email +
                                ')',
                        },
                        props: {
                            isRoot: true,
                        },
                    }
                );

                // incident.
                await IncidentService.acknowledgeIncident(
                    item.triggeredByIncidentId!,
                    item.userId!
                );
            }
        }

        return onUpdate;
    }
}

export default new Service();
