import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Incident';
import DatabaseService, { OnCreate } from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';
import MonitorService from './MonitorService';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import IncidentStateTimelineService from './IncidentStateTimelineService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import IncidentState from 'Model/Models/IncidentState';
import IncidentStateService from './IncidentStateService';
import IncidentOwnerTeamService from './IncidentOwnerTeamService';
import IncidentOwnerTeam from 'Model/Models/IncidentOwnerTeam';
import IncidentOwnerUser from 'Model/Models/IncidentOwnerUser';
import IncidentOwnerUserService from './IncidentOwnerUserService';
import Typeof from 'Common/Types/Typeof';
import { DashboardUrl } from '../Config';
import URL from 'Common/Types/API/URL';
import User from 'Model/Models/User';
import TeamMemberService from './TeamMemberService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.props.tenantId && !createBy.props.isRoot) {
            throw new BadDataException(
                'ProjectId required to create incident.'
            );
        }

        const incidentState: IncidentState | null =
            await IncidentStateService.findOneBy({
                query: {
                    projectId:
                        createBy.props.tenantId || createBy.data.projectId!,
                    isCreatedState: true,
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                },
            });

        if (!incidentState || !incidentState.id) {
            throw new BadDataException(
                'Created incident state not found for this project. Please add created incident state from settings.'
            );
        }

        createBy.data.currentIncidentStateId = incidentState.id;

        return { createBy, carryForward: null };
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        if (!createdItem.projectId) {
            throw new BadDataException('projectId is required');
        }

        if (!createdItem.id) {
            throw new BadDataException('id is required');
        }

        if (!createdItem.currentIncidentStateId) {
            throw new BadDataException('currentIncidentStateId is required');
        }

        if (createdItem.changeMonitorStatusToId && createdItem.projectId) {
            // change status of all the monitors.
            await MonitorService.changeMonitorStatus(
                createdItem.projectId,
                createdItem.monitors?.map((monitor: Monitor) => {
                    return new ObjectID(monitor._id || '');
                }) || [],
                createdItem.changeMonitorStatusToId,
                true, // notifyMonitorOwners
                onCreate.createBy.props
            );
        }

        await this.changeIncidentState(
            createdItem.projectId,
            createdItem.id,
            createdItem.currentIncidentStateId,
            false,
            false,
            {
                isRoot: true,
            }
        );

        // add owners.

        if (
            onCreate.createBy.miscDataProps &&
            (onCreate.createBy.miscDataProps['ownerTeams'] ||
                onCreate.createBy.miscDataProps['ownerUsers'])
        ) {
            await this.addOwners(
                createdItem.projectId,
                createdItem.id,
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

    public async findOwners(incidentId: ObjectID): Promise<Array<User>> {
        const ownerUsers: Array<IncidentOwnerUser> =
            await IncidentOwnerUserService.findBy({
                query: {
                    incidentId: incidentId,
                },
                select: {
                    _id: true,
                },
                populate: {
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

        const ownerTeams: Array<IncidentOwnerTeam> =
            await IncidentOwnerTeamService.findBy({
                query: {
                    incidentId: incidentId,
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
            ownerUsers.map((ownerUser: IncidentOwnerUser) => {
                return ownerUser.user!;
            }) || [];

        if (ownerTeams.length > 0) {
            const teamIds: Array<ObjectID> =
                ownerTeams.map((ownerTeam: IncidentOwnerTeam) => {
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

    public async addOwners(
        projectId: ObjectID,
        incidentId: ObjectID,
        userIds: Array<ObjectID>,
        teamIds: Array<ObjectID>,
        notifyOwners: boolean,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        for (let teamId of teamIds) {
            if (typeof teamId === Typeof.String) {
                teamId = new ObjectID(teamId.toString());
            }

            const teamOwner: IncidentOwnerTeam = new IncidentOwnerTeam();
            teamOwner.incidentId = incidentId;
            teamOwner.projectId = projectId;
            teamOwner.teamId = teamId;
            teamOwner.isOwnerNotified = !notifyOwners;

            await IncidentOwnerTeamService.create({
                data: teamOwner,
                props: props,
            });
        }

        for (let userId of userIds) {
            if (typeof userId === Typeof.String) {
                userId = new ObjectID(userId.toString());
            }
            const teamOwner: IncidentOwnerUser = new IncidentOwnerUser();
            teamOwner.incidentId = incidentId;
            teamOwner.projectId = projectId;
            teamOwner.userId = userId;
            teamOwner.isOwnerNotified = !notifyOwners;
            await IncidentOwnerUserService.create({
                data: teamOwner,
                props: props,
            });
        }
    }

    public getIncidentLinkInDashboard(
        projectId: ObjectID,
        incidentId: ObjectID
    ): URL {
        return URL.fromString(DashboardUrl.toString()).addRoute(
            `/${projectId.toString()}/incidents/${incidentId.toString()}`
        );
    }

    public async changeIncidentState(
        projectId: ObjectID,
        incidentId: ObjectID,
        incidentStateId: ObjectID,
        notifyStatusPageSubscribers: boolean,
        notifyOwners: boolean,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        const statusTimeline: IncidentStateTimeline =
            new IncidentStateTimeline();

        statusTimeline.incidentId = incidentId;
        statusTimeline.incidentStateId = incidentStateId;
        statusTimeline.projectId = projectId;
        statusTimeline.isOwnerNotified = !notifyOwners;
        statusTimeline.isStatusPageSubscribersNotified =
            !notifyStatusPageSubscribers;

        await IncidentStateTimelineService.create({
            data: statusTimeline,
            props: props,
        });
    }
}
export default new Service();
