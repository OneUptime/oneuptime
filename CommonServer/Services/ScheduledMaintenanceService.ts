import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/ScheduledMaintenance';
import DatabaseService, { OnCreate } from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';
import MonitorService from './MonitorService';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import ScheduledMaintenanceStateTimelineService from './ScheduledMaintenanceStateTimelineService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import ScheduledMaintenanceStateService from './ScheduledMaintenanceStateService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import ScheduledMaintenanceOwnerUserService from './ScheduledMaintenanceOwnerUserService';
import ScheduledMaintenanceOwnerUser from 'Model/Models/ScheduledMaintenanceOwnerUser';
import Typeof from 'Common/Types/Typeof';
import ScheduledMaintenanceOwnerTeamService from './ScheduledMaintenanceOwnerTeamService';
import ScheduledMaintenanceOwnerTeam from 'Model/Models/ScheduledMaintenanceOwnerTeam';
import TeamMemberService from './TeamMemberService';
import User from 'Model/Models/User';
import { DashboardUrl } from '../Config';
import URL from 'Common/Types/API/URL';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.props.tenantId) {
            throw new BadDataException('ProjectId required to create monitor.');
        }

        const scheduledMaintenanceState: ScheduledMaintenanceState | null =
            await ScheduledMaintenanceStateService.findOneBy({
                query: {
                    projectId: createBy.props.tenantId,
                    isScheduledState: true,
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                },
            });

        if (!scheduledMaintenanceState || !scheduledMaintenanceState.id) {
            throw new BadDataException(
                'Scheduled state not found for this project. Please add an scheduled evenmt state from settings.'
            );
        }

        createBy.data.currentScheduledMaintenanceStateId =
            scheduledMaintenanceState.id;

        return { createBy, carryForward: null };
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        // create new scheduled maintenance state timeline.

        const timeline: ScheduledMaintenanceStateTimeline =
            new ScheduledMaintenanceStateTimeline();
        timeline.projectId = createdItem.projectId!;
        timeline.scheduledMaintenanceId = createdItem.id!;
        timeline.isOwnerNotified = true; // ignore notifying owners because you already notify for Scheduled Event, you dont have to notify them for timeline event.
        timeline.isStatusPageSubscribersNotified = true; // ignore notifying subscribers because you already notify for Scheduled Event, you dont have to notify them for timeline event.
        timeline.scheduledMaintenanceStateId =
            createdItem.currentScheduledMaintenanceStateId!;

        await ScheduledMaintenanceStateTimelineService.create({
            data: timeline,
            props: {
                isRoot: true,
            },
        });

        if (
            createdItem.projectId &&
            createdItem.id &&
            onCreate.createBy.miscDataProps &&
            (onCreate.createBy.miscDataProps['ownerTeams'] ||
                onCreate.createBy.miscDataProps['ownerUsers'])
        ) {
            await this.addOwners(
                createdItem.projectId!,
                createdItem.id!,
                (onCreate.createBy.miscDataProps[
                    'ownerUsers'
                ] as Array<ObjectID>) || [],
                (onCreate.createBy.miscDataProps[
                    'ownerTeams'
                ] as Array<ObjectID>) || [],
                false,
                onCreate.createBy.props
            );
        }

        return createdItem;
    }

    public async addOwners(
        projectId: ObjectID,
        scheduledMaintenanceId: ObjectID,
        userIds: Array<ObjectID>,
        teamIds: Array<ObjectID>,
        notifyOwners: boolean,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        for (let teamId of teamIds) {
            if (typeof teamId === Typeof.String) {
                teamId = new ObjectID(teamId.toString());
            }

            const teamOwner: ScheduledMaintenanceOwnerTeam =
                new ScheduledMaintenanceOwnerTeam();
            teamOwner.scheduledMaintenanceId = scheduledMaintenanceId;
            teamOwner.projectId = projectId;
            teamOwner.teamId = teamId;
            teamOwner.isOwnerNotified = !notifyOwners;

            await ScheduledMaintenanceOwnerTeamService.create({
                data: teamOwner,
                props: props,
            });
        }

        for (let userId of userIds) {
            if (typeof userId === Typeof.String) {
                userId = new ObjectID(userId.toString());
            }
            const teamOwner: ScheduledMaintenanceOwnerUser =
                new ScheduledMaintenanceOwnerUser();
            teamOwner.scheduledMaintenanceId = scheduledMaintenanceId;
            teamOwner.projectId = projectId;
            teamOwner.isOwnerNotified = !notifyOwners;
            teamOwner.userId = userId;
            await ScheduledMaintenanceOwnerUserService.create({
                data: teamOwner,
                props: props,
            });
        }
    }

    public getScheduledMaintenanceLinkInDashboard(
        projectId: ObjectID,
        scheduledMaintenanceId: ObjectID
    ): URL {
        return URL.fromString(DashboardUrl.toString()).addRoute(
            `/${projectId.toString()}/scheduled-maintenance-events/${scheduledMaintenanceId.toString()}`
        );
    }

    public async findOwners(
        scheduledMaintenanceId: ObjectID
    ): Promise<Array<User>> {
        if (!scheduledMaintenanceId) {
            throw new BadDataException('scheduledMaintenanceId is required');
        }

        const ownerUsers: Array<ScheduledMaintenanceOwnerUser> =
            await ScheduledMaintenanceOwnerUserService.findBy({
                query: {
                    scheduledMaintenanceId: scheduledMaintenanceId,
                },
                select: {
                    _id: true,
                    user: {
                        _id: true,
                        email: true,
                        name: true,
                    },
                },

                props: {
                    isRoot: true,
                },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
            });

        const ownerTeams: Array<ScheduledMaintenanceOwnerTeam> =
            await ScheduledMaintenanceOwnerTeamService.findBy({
                query: {
                    scheduledMaintenanceId: scheduledMaintenanceId,
                },
                select: {
                    _id: true,
                    teamId: true,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

        const users: Array<User> =
            ownerUsers.map((ownerUser: ScheduledMaintenanceOwnerUser) => {
                return ownerUser.user!;
            }) || [];

        if (ownerTeams.length > 0) {
            const teamIds: Array<ObjectID> =
                ownerTeams.map((ownerTeam: ScheduledMaintenanceOwnerTeam) => {
                    return ownerTeam.teamId!;
                }) || [];

            const teamUsers: Array<User> =
                await TeamMemberService.getUsersInTeams(teamIds);

            for (const teamUser of teamUsers) {
                //check if the user is already added.
                const isUserAlreadyAdded: User | undefined = users.find(
                    (user: User) => {
                        return user.id!.toString() === teamUser.id!.toString();
                    }
                );

                if (!isUserAlreadyAdded) {
                    users.push(teamUser);
                }
            }
        }

        return users;
    }

    public async changeAttachedMonitorStates(
        item: Model,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        if (!item.projectId) {
            throw new BadDataException('projectId is required');
        }

        if (!item.id) {
            throw new BadDataException('id is required');
        }

        if (item.changeMonitorStatusToId && item.projectId) {
            // change status of all the monitors.
            await MonitorService.changeMonitorStatus(
                item.projectId,
                item.monitors?.map((monitor: Monitor) => {
                    return new ObjectID(monitor._id || '');
                }) || [],
                item.changeMonitorStatusToId,
                true, // notify owners
                "Changed because of scheduled maintenance event: "+item.id.toString(),
                undefined,
                props
            );
        }
    }

    public async changeScheduledMaintenanceState(
        projectId: ObjectID,
        scheduledMaintenanceId: ObjectID,
        scheduledMaintenanceStateId: ObjectID,
        notifyStatusPageSubscribers: boolean,
        notifyOwners: boolean,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        await this.updateBy({
            data: {
                currentScheduledMaintenanceStateId:
                    scheduledMaintenanceStateId.id,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            query: {
                _id: scheduledMaintenanceId.toString()!,
            },
            props: {
                isRoot: true,
            },
        });

        const statusTimeline: ScheduledMaintenanceStateTimeline =
            new ScheduledMaintenanceStateTimeline();

        statusTimeline.scheduledMaintenanceId = scheduledMaintenanceId;
        statusTimeline.scheduledMaintenanceStateId =
            scheduledMaintenanceStateId;
        statusTimeline.projectId = projectId;
        statusTimeline.isOwnerNotified = !notifyOwners;
        statusTimeline.isStatusPageSubscribersNotified =
            !notifyStatusPageSubscribers;

        await ScheduledMaintenanceStateTimelineService.create({
            data: statusTimeline,
            props: props,
        });
    }
}
export default new Service();
