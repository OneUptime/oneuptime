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
import UserService from './UserService';
import { JSONObject } from 'Common/Types/JSON';
import OnCallDutyPolicyService from './OnCallDutyPolicyService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async acknowledgeIncident(incidentId: ObjectID, acknowledgedByUserId: ObjectID): Promise<void> {
        const incident: Model | null = await this.findOneById({
            id: incidentId,
            select: {
                projectId: true,
            },
            props: {
                isRoot: true,
            }
        });

        if (!incident || !incident.projectId) {
            throw new BadDataException('Incident not found.');
        }

        const incidentState: IncidentState | null = await IncidentStateService.findOneBy({
            query: {
                projectId: incident.projectId,
                isAcknowledgedState: true,
            },
            select: {
                _id: true,
            },
            props: {
                isRoot: true,
            }
        });


        if (!incidentState || !incidentState.id) {
            throw new BadDataException('Acknowledged state not found for this project. Please add acknowledged state from settings.');
        }

        const incidentStateTimeline: IncidentStateTimeline =
            new IncidentStateTimeline();
        incidentStateTimeline.projectId = incident.projectId;
        incidentStateTimeline.incidentId = incidentId;
        incidentStateTimeline.incidentStateId = incidentState.id;
        incidentStateTimeline.createdByUserId = acknowledgedByUserId;

        await IncidentStateTimelineService.create({
            data: incidentStateTimeline,
            props: {
                isRoot: true,
            }
        });
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

        if (
            (createBy.data.createdByUserId ||
                createBy.data.createdByUser ||
                createBy.props.userId) &&
            !createBy.data.rootCause
        ) {
            let userId: ObjectID | undefined = createBy.data.createdByUserId;

            if (createBy.props.userId) {
                userId = createBy.props.userId;
            }

            if (createBy.data.createdByUser && createBy.data.createdByUser.id) {
                userId = createBy.data.createdByUser.id;
            }

            const user: User | null = await UserService.findOneBy({
                query: {
                    _id: userId?.toString()!,
                },
                select: {
                    _id: true,
                    name: true,
                    email: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (user) {
                createBy.data.rootCause = `Incident created by ${user.name} (${user.email})`;
            }
        }

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
                createdItem.rootCause ||
                'Status was changed because incident ' +
                createdItem.id.toString() +
                ' was created.',
                createdItem.createdStateLog,
                onCreate.createBy.props
            );
        }

        await this.changeIncidentState(
            createdItem.projectId,
            createdItem.id,
            createdItem.currentIncidentStateId,
            false,
            false,
            createdItem.rootCause,
            createdItem.createdStateLog,
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

        if (
            createdItem.onCallDutyPolicies?.length &&
            createdItem.onCallDutyPolicies?.length > 0
        ) {
            for (const policy of createdItem.onCallDutyPolicies) {
                await OnCallDutyPolicyService.executePolicy(
                    new ObjectID(policy._id as string),
                    { triggeredByIncidentId: createdItem.id! }
                );
            }
        }

        return createdItem;
    }

    public async findOwners(incidentId: ObjectID): Promise<Array<User>> {
        if (!incidentId) {
            throw new BadDataException('incidentId is required');
        }

        const ownerUsers: Array<IncidentOwnerUser> =
            await IncidentOwnerUserService.findBy({
                query: {
                    incidentId: incidentId,
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
        rootCause: string | undefined,
        stateChangeLog: JSONObject | undefined,
        props: DatabaseCommonInteractionProps | undefined
    ): Promise<void> {
        const statusTimeline: IncidentStateTimeline =
            new IncidentStateTimeline();

        statusTimeline.incidentId = incidentId;
        statusTimeline.incidentStateId = incidentStateId;
        statusTimeline.projectId = projectId;
        statusTimeline.isOwnerNotified = !notifyOwners;
        statusTimeline.isStatusPageSubscribersNotified =
            !notifyStatusPageSubscribers;

        if (stateChangeLog) {
            statusTimeline.stateChangeLog = stateChangeLog;
        }
        if (rootCause) {
            statusTimeline.rootCause = rootCause;
        }

        await IncidentStateTimelineService.create({
            data: statusTimeline,
            props: props || {},
        });
    }
}
export default new Service();
