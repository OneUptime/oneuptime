import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Project';
import DatabaseService, { OnCreate, OnFind } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import TeamService from './TeamService';
import Team from 'Model/Models/Team';
import TeamMemberService from './TeamMemberService';
import TeamMember from 'Model/Models/TeamMember';
import TeamPermission from 'Model/Models/TeamPermission';
import Permission from 'Common/Types/Permission';
import TeamPermissionService from './TeamPermissionService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FindBy from '../Types/Database/FindBy';
import { In } from 'typeorm';
import QueryHelper from '../Types/Database/QueryHelper';
import ObjectID from 'Common/Types/ObjectID';
import OneUptimeDate from 'Common/Types/Date';
import MonitorStatus from 'Model/Models/MonitorStatus';
import { Yellow, Green, Red, Moroon } from 'Common/Types/BrandColors';
import MonitorStatusService from './MonitorStatusService';
import IncidentState from 'Model/Models/IncidentState';
import IncidentStateService from './IncidentStateService';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import IncidentSeverityService from './IncidentSeverityService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        data: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!data.data.name) {
            throw new BadDataException('Project name is required');
        }

        // check if the user has the project with the same name. If yes, reject.

        let existingProjectWithSameNameCount: number = 0;
        if (
            data.props.userGlobalAccessPermission &&
            data.props.userGlobalAccessPermission?.projectIds.length > 0
        ) {
            existingProjectWithSameNameCount = (
                await this.countBy({
                    query: {
                        _id:
                            data.props.userGlobalAccessPermission?.projectIds.map(
                                (item: ObjectID) => {
                                    return item.toString();
                                }
                            ) || [],
                        name: QueryHelper.findWithSameText(data.data.name!),
                    },
                    props: {
                        isRoot: true,
                    },
                })
            ).toNumber();
        }

        if (existingProjectWithSameNameCount > 0) {
            throw new BadDataException(
                'Project with the same name already exists'
            );
        }

        if (data.props.userId) {
            data.data.createdByUserId = data.props.userId;
        } else {
            throw new NotAuthorizedException(
                'User should be logged in to create the project.'
            );
        }

        return Promise.resolve({ createBy: data, carryForward: null });
    }

    protected override async onCreateSuccess(
        _onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        createdItem = await this.addDefaultProjectTeams(createdItem);
        createdItem = await this.addDefaultMonitorStatus(createdItem);
        createdItem = await this.addDefaultIncidentState(createdItem);
        createdItem = await this.addDefaultIncidentSeverity(createdItem);

        return createdItem;
    }

    private async addDefaultIncidentState(createdItem: Model): Promise<Model> {
        let createdIncidentState: IncidentState = new IncidentState();
        createdIncidentState.name = 'Created';
        createdIncidentState.description =
            'When an incident is created, it belongs to this state';
        createdIncidentState.color = Red;
        createdIncidentState.isCreatedState = true;
        createdIncidentState.projectId = createdItem.id!;
        createdIncidentState.order = 1;

        createdIncidentState = await IncidentStateService.create({
            data: createdIncidentState,
            props: {
                isRoot: true,
            },
        });

        let acknowledgedIncidentState: IncidentState = new IncidentState();
        acknowledgedIncidentState.name = 'Acknowledged';
        acknowledgedIncidentState.description =
            'When an incident is acknowledged, it belongs to this state.';
        acknowledgedIncidentState.color = Yellow;
        acknowledgedIncidentState.isAcknowledgedState = true;
        acknowledgedIncidentState.projectId = createdItem.id!;
        acknowledgedIncidentState.order = 2;

        acknowledgedIncidentState = await IncidentStateService.create({
            data: acknowledgedIncidentState,
            props: {
                isRoot: true,
            },
        });

        let resolvedIncidentState: IncidentState = new IncidentState();
        resolvedIncidentState.name = 'Resolved';
        resolvedIncidentState.description =
            'When an incident is resolved, it belongs to this state.';
        resolvedIncidentState.color = Green;
        resolvedIncidentState.isResolvedState = true;
        resolvedIncidentState.projectId = createdItem.id!;
        resolvedIncidentState.order = 3;

        resolvedIncidentState = await IncidentStateService.create({
            data: resolvedIncidentState,
            props: {
                isRoot: true,
            },
        });

        return createdItem;
    }

    private async addDefaultIncidentSeverity(
        createdItem: Model
    ): Promise<Model> {
        let criticalIncident: IncidentSeverity = new IncidentSeverity();
        criticalIncident.name = 'Critial Incident';
        criticalIncident.description =
            'Issues causing very high impact to customers. Immediate response is required. Examples include a full outage, or a data breach.';
        criticalIncident.color = Moroon;
        criticalIncident.projectId = createdItem.id!;
        criticalIncident.order = 1;

        criticalIncident = await IncidentSeverityService.create({
            data: criticalIncident,
            props: {
                isRoot: true,
            },
        });

        let majorIncident: IncidentSeverity = new IncidentSeverity();
        majorIncident.name = 'Major Incident';
        majorIncident.description =
            'Issues causing significant impact. Immediate response is usually required. We might have some workarounds that mitigate the impact on customers. Examples include an important sub-system failing.';
        majorIncident.color = Red;
        majorIncident.projectId = createdItem.id!;
        majorIncident.order = 2;

        majorIncident = await IncidentSeverityService.create({
            data: majorIncident,
            props: {
                isRoot: true,
            },
        });

        let minorIncident: IncidentSeverity = new IncidentSeverity();
        minorIncident.name = 'Minor Incident';
        minorIncident.description =
            'Issues with low impact, which can usually be handled within working hours. Most customers are unlikely to notice any problems. Examples include a slight drop in application performance.';
        minorIncident.color = Yellow;
        minorIncident.projectId = createdItem.id!;
        minorIncident.order = 3;

        minorIncident = await IncidentSeverityService.create({
            data: minorIncident,
            props: {
                isRoot: true,
            },
        });

        return createdItem;
    }

    private async addDefaultMonitorStatus(createdItem: Model): Promise<Model> {
        let operationalStatus: MonitorStatus = new MonitorStatus();
        operationalStatus.name = 'Operational';
        operationalStatus.description = 'Monitor operating normally';
        operationalStatus.projectId = createdItem.id!;
        operationalStatus.priority = 1;
        operationalStatus.isOperationalState = true;
        operationalStatus.color = Green;

        operationalStatus = await MonitorStatusService.create({
            data: operationalStatus,
            props: {
                isRoot: true,
            },
        });

        let degradedStatus: MonitorStatus = new MonitorStatus();
        degradedStatus.name = 'Degraded';
        degradedStatus.description =
            'Monitor is operating at reduced performance.';
        degradedStatus.priority = 2;
        degradedStatus.projectId = createdItem.id!;
        degradedStatus.color = Yellow;

        degradedStatus = await MonitorStatusService.create({
            data: degradedStatus,
            props: {
                isRoot: true,
            },
        });

        let downStatus: MonitorStatus = new MonitorStatus();
        downStatus.name = 'Offline';
        downStatus.description = 'Monitor is offline.';
        downStatus.isOfflineState = true;
        downStatus.projectId = createdItem.id!;
        downStatus.priority = 3;
        downStatus.color = Red;

        downStatus = await MonitorStatusService.create({
            data: downStatus,
            props: {
                isRoot: true,
            },
        });

        return createdItem;
    }

    private async addDefaultProjectTeams(createdItem: Model): Promise<Model> {
        // add a team member.

        // Owner Team.
        let ownerTeam: Team = new Team();
        ownerTeam.projectId = createdItem.id!;
        ownerTeam.name = 'Owners';
        ownerTeam.isPermissionsEditable = false;
        ownerTeam.isTeamEditable = false;
        ownerTeam.isTeamDeleteable = false;
        ownerTeam.description =
            'This team is for project owners. Adding team members to this team will give them root level permissions.';

        ownerTeam = await TeamService.create({
            data: ownerTeam,
            props: {
                isRoot: true,
            },
        });

        // Add current user to owners team.

        let ownerTeamMember: TeamMember = new TeamMember();
        ownerTeamMember.projectId = createdItem.id!;
        ownerTeamMember.userId = createdItem.createdByUserId!;
        ownerTeamMember.hasAcceptedInvitation = true;
        ownerTeamMember.invitationAcceptedAt = OneUptimeDate.getCurrentDate();
        ownerTeamMember.teamId = ownerTeam.id!;

        ownerTeamMember = await TeamMemberService.create({
            data: ownerTeamMember,
            props: {
                isRoot: true,
            },
        });

        // Add permissions for this team.

        const ownerPermissions: TeamPermission = new TeamPermission();
        ownerPermissions.permission = Permission.ProjectOwner;
        ownerPermissions.teamId = ownerTeam.id!;
        ownerPermissions.projectId = createdItem.id!;

        await TeamPermissionService.create({
            data: ownerPermissions,
            props: {
                isRoot: true,
            },
        });

        // Admin Team.
        const adminTeam: Team = new Team();
        adminTeam.projectId = createdItem.id!;
        adminTeam.name = 'Admin';
        adminTeam.isPermissionsEditable = false;
        adminTeam.isTeamDeleteable = false;
        adminTeam.isTeamEditable = false;
        adminTeam.description =
            'This team is for project admins. Admins can invite members to any team and create project resources.';

        await TeamService.create({
            data: adminTeam,
            props: {
                isRoot: true,
            },
        });

        const adminPermissions: TeamPermission = new TeamPermission();
        adminPermissions.permission = Permission.ProjectAdmin;
        adminPermissions.teamId = adminTeam.id!;
        adminPermissions.projectId = createdItem.id!;

        await TeamPermissionService.create({
            data: adminPermissions,
            props: {
                isRoot: true,
            },
        });

        // Members Team.
        const memberTeam: Team = new Team();
        memberTeam.projectId = createdItem.id!;
        memberTeam.isPermissionsEditable = true;
        memberTeam.name = 'Members';
        memberTeam.isTeamDeleteable = true;
        memberTeam.description =
            'This team is for project members. Members can interact with any project resources like monitors, incidents, etc.';

        await TeamService.create({
            data: memberTeam,
            props: {
                isRoot: true,
            },
        });

        const memberPermissions: TeamPermission = new TeamPermission();
        memberPermissions.permission = Permission.ProjectMember;
        memberPermissions.teamId = memberTeam.id!;
        memberPermissions.projectId = createdItem.id!;

        await TeamPermissionService.create({
            data: memberPermissions,
            props: {
                isRoot: true,
            },
        });

        return createdItem;
    }

    protected override async onBeforeFind(
        findBy: FindBy<Model>
    ): Promise<OnFind<Model>> {
        // if user has no project id, then he should not be able to access any project.
        if (
            (!findBy.props.isRoot &&
                !findBy.props.userGlobalAccessPermission?.projectIds) ||
            findBy.props.userGlobalAccessPermission?.projectIds.length === 0
        ) {
            findBy.props.isRoot = true;
            findBy.query._id = In([]); // should not get any projects.
        }

        return { findBy, carryForward: null };
    }
}
export default new Service();
