import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Monitor';
import DatabaseService, { OnCreate, OnDelete } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import MonitorStatus from 'Model/Models/MonitorStatus';
import MonitorStatusService from './MonitorStatusService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MonitorStatusTimelineService from './MonitorStatusTimelineService';
import ObjectID from 'Common/Types/ObjectID';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import ProbeService from './ProbeService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import MonitorProbe from 'Model/Models/MonitorProbe';
import MonitorProbeService from './MonitorProbeService';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import Probe from 'Model/Models/Probe';
import ActiveMonitoringMeteredPlan from '../Types/Billing/MeteredPlan/ActiveMonitoringMeteredPlan';
import { DashboardUrl, IsBillingEnabled } from '../Config';
import MonitorOwnerUserService from './MonitorOwnerUserService';
import MonitorOwnerUser from 'Model/Models/MonitorOwnerUser';
import MonitorOwnerTeamService from './MonitorOwnerTeamService';
import MonitorOwnerTeam from 'Model/Models/MonitorOwnerTeam';
import Typeof from 'Common/Types/Typeof';
import TeamMemberService from './TeamMemberService';
import User from 'Model/Models/User';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<Model>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<Model>> {
        if (onDelete.deleteBy.props.tenantId && IsBillingEnabled) {
            await ActiveMonitoringMeteredPlan.updateCurrentQuantity(
                onDelete.deleteBy.props.tenantId
            );
        }

        return onDelete;
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.data.monitorType) {
            throw new BadDataException(
                'Monitor type required to create monitor.'
            );
        }

        if (!Object.values(MonitorType).includes(createBy.data.monitorType)) {
            throw new BadDataException(
                `Invalid monitor type "${
                    createBy.data.monitorType
                }". Valid monitor types are ${Object.values(MonitorType).join(
                    ', '
                )}.`
            );
        }

        if (!createBy.props.tenantId) {
            throw new BadDataException('ProjectId required to create monitor.');
        }

        const monitorStatus: MonitorStatus | null =
            await MonitorStatusService.findOneBy({
                query: {
                    projectId: createBy.props.tenantId,
                    isOperationalState: true,
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                },
            });

        if (!monitorStatus || !monitorStatus.id) {
            throw new BadDataException(
                'Operational status not found for this project. Please add an operational status'
            );
        }

        createBy.data.currentMonitorStatusId = monitorStatus.id;

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

        if (!createdItem.currentMonitorStatusId) {
            throw new BadDataException('currentMonitorStatusId is required');
        }

        await this.changeMonitorStatus(
            createdItem.projectId,
            [createdItem.id],
            createdItem.currentMonitorStatusId,
            false, // notifyOwners = false
            "This status was created when the monitor was created.",
            undefined, 
            onCreate.createBy.props
        );

        if (
            createdItem.monitorType &&
            (createdItem.monitorType === MonitorType.API ||
                createdItem.monitorType === MonitorType.IncomingRequest ||
                createdItem.monitorType === MonitorType.Website ||
                createdItem.monitorType === MonitorType.Ping ||
                createdItem.monitorType === MonitorType.IP)
        ) {
            await this.addDefaultProbesToMonitor(
                createdItem.projectId,
                createdItem.id
            );
        }

        if (IsBillingEnabled) {
            await ActiveMonitoringMeteredPlan.updateCurrentQuantity(
                createdItem.projectId
            );
        }

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

    public getMonitorLinkInDashboard(
        projectId: ObjectID,
        monitorId: ObjectID
    ): URL {
        return URL.fromString(DashboardUrl.toString()).addRoute(
            `/${projectId.toString()}/monitors/${monitorId.toString()}`
        );
    }

    public async findOwners(monitorId: ObjectID): Promise<Array<User>> {
        if (!monitorId) {
            throw new BadDataException('monitorId is required');
        }

        const ownerUsers: Array<MonitorOwnerUser> =
            await MonitorOwnerUserService.findBy({
                query: {
                    monitorId: monitorId,
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

        const ownerTeams: Array<MonitorOwnerTeam> =
            await MonitorOwnerTeamService.findBy({
                query: {
                    monitorId: monitorId,
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
            ownerUsers.map((ownerUser: MonitorOwnerUser) => {
                return ownerUser.user!;
            }) || [];

        if (ownerTeams.length > 0) {
            const teamIds: Array<ObjectID> =
                ownerTeams.map((ownerTeam: MonitorOwnerTeam) => {
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
        monitorId: ObjectID,
        userIds: Array<ObjectID>,
        teamIds: Array<ObjectID>,
        notifyOwners: boolean,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        for (let teamId of teamIds) {
            if (typeof teamId === Typeof.String) {
                teamId = new ObjectID(teamId.toString());
            }

            const teamOwner: MonitorOwnerTeam = new MonitorOwnerTeam();
            teamOwner.monitorId = monitorId;
            teamOwner.projectId = projectId;
            teamOwner.teamId = teamId;
            teamOwner.isOwnerNotified = !notifyOwners;

            await MonitorOwnerTeamService.create({
                data: teamOwner,
                props: props,
            });
        }

        for (let userId of userIds) {
            if (typeof userId === Typeof.String) {
                userId = new ObjectID(userId.toString());
            }
            const teamOwner: MonitorOwnerUser = new MonitorOwnerUser();
            teamOwner.monitorId = monitorId;
            teamOwner.projectId = projectId;
            teamOwner.userId = userId;
            teamOwner.isOwnerNotified = !notifyOwners;
            await MonitorOwnerUserService.create({
                data: teamOwner,
                props: props,
            });
        }
    }

    public async addDefaultProbesToMonitor(
        projectId: ObjectID,
        monitorId: ObjectID
    ): Promise<void> {
        const globalProbes: Array<Probe> = await ProbeService.findBy({
            query: {
                isGlobalProbe: true,
                shouldAutoEnableProbeOnNewMonitors: true,
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

        const projectProbes: Array<Probe> = await ProbeService.findBy({
            query: {
                isGlobalProbe: false,
                shouldAutoEnableProbeOnNewMonitors: true,
                projectId: projectId,
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

        const totalProbes: Array<Probe> = [...globalProbes, ...projectProbes];

        for (const probe of totalProbes) {
            const monitorProbe: MonitorProbe = new MonitorProbe();

            monitorProbe.monitorId = monitorId;
            monitorProbe.probeId = probe.id!;
            monitorProbe.projectId = projectId;
            monitorProbe.isEnabled = true;

            await MonitorProbeService.create({
                data: monitorProbe,
                props: {
                    isRoot: true,
                },
            });
        }
    }

    public async changeMonitorStatus(
        projectId: ObjectID,
        monitorIds: Array<ObjectID>,
        monitorStatusId: ObjectID,
        notifyOwners: boolean,
        rootCause: string | undefined,
        statusChangeLog: JSONObject | undefined,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        for (const monitorId of monitorIds) {
            const statusTimeline: MonitorStatusTimeline =
                new MonitorStatusTimeline();

            statusTimeline.monitorId = monitorId;
            statusTimeline.monitorStatusId = monitorStatusId;
            statusTimeline.projectId = projectId;
            statusTimeline.isOwnerNotified = !notifyOwners;

            if (statusChangeLog) {
                statusTimeline.statusChangeLog = statusChangeLog;
            }
            if (rootCause) {
                statusTimeline.rootCause = rootCause;
            }

            await MonitorStatusTimelineService.create({
                data: statusTimeline,
                props: props,
            });
        }
    }
}
export default new Service();
