import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/Project';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import TeamService from './TeamService';
import Team from 'Common/Models/Team';
import TeamMemberService from './TeamMemberService';
import TeamMember from 'Common/Models/TeamMember';
import TeamPermission from 'Common/Models/TeamPermission';
import Permission from 'Common/Types/Permission';
import TeamPermissionService from './TeamPermissionService';
import User from 'Common/Models/User';
import BadDataException from 'Common/Types/Exception/BadDataException';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        data: CreateBy<Model>
    ): Promise<CreateBy<Model>> {

        if (!data.data.name) {
            throw new BadDataException("Project name is required");
        }

        // check if the user has the project with the same name. If yes, reject. 

        const existingProjectWithSameNameCount =
            await this.getQueryBuilder("Project")
                .leftJoinAndSelect("Project.users", "user")
                .where("user._id = :id", { id: data.props.userId?.toString() })
                .andWhere("LOWER(Project.name) = LOWER(:name)", { name: data.data.name })
                .getCount();

        if (existingProjectWithSameNameCount > 0) {
            throw new BadDataException("Project with the same name already exists");
        }

        if (data.props.userId) {
            data.data.createdByUserId = data.props.userId;

            if (!data.data.users) {
                data.data.users = [];
            }
            const user = new User();
            user.id = data.props.userId;
            data.data.users?.push(user);

        } else {
            throw new NotAuthorizedException(
                'User should be logged in to create the project.'
            );
        }

        return Promise.resolve(data);
    }

    protected override async onCreateSuccess(
        createdItem: CreateBy<Model>
    ): Promise<CreateBy<Model>> {
        // add a team member.

        debugger; 
        // Owner Team. 
        let ownerTeam = new Team();
        ownerTeam.projectId = createdItem.data.id!;
        ownerTeam.name = "Owners";
        ownerTeam.isPermissionsEditable = false;
        ownerTeam.isTeamDeleteable = false; 
        ownerTeam.description = "This team is for project owners. Adding team members to this team will give them root level permissions.";
        
        ownerTeam = await TeamService.create({
            data: ownerTeam,
            props: {
                isRoot: true
            }
        })

        // Add current user to owners team. 

        let ownerTeamMember: TeamMember = new TeamMember();
        ownerTeamMember.projectId = createdItem.data.id!
        ownerTeamMember.userId = createdItem.props.userId!;
        ownerTeamMember.teamId = ownerTeam.id!;

        ownerTeamMember = await TeamMemberService.create({
            data: ownerTeamMember,
            props: {
                isRoot: true
            }
        });

        // Add permissions for this team. 

        let ownerPermissions: TeamPermission = new TeamPermission();
        ownerPermissions.permission = Permission.ProjectOwner;
        ownerPermissions.teamId = ownerTeam.id!;
        ownerPermissions.projectId = createdItem.data.id!

        await TeamPermissionService.create({
            data: ownerPermissions, 
            props: {
                isRoot: true
            }
        })
        

        // Admin Team. 
        const adminTeam = new Team();
        adminTeam.projectId = createdItem.data.id!;
        adminTeam.name = "Admin";
        adminTeam.isPermissionsEditable = false;
        adminTeam.isTeamDeleteable = false; 
        adminTeam.description = "This team is for project admins. Admins can invite members to any team and create project resources.";

        await TeamService.create({
            data: adminTeam,
            props: {
                isRoot: true
            }
        })

        let adminPermissions: TeamPermission = new TeamPermission();
        adminPermissions.permission = Permission.ProjectAdmin;
        adminPermissions.teamId = ownerTeam.id!;
        adminPermissions.projectId = createdItem.data.id!

        await TeamPermissionService.create({
            data: adminPermissions, 
            props: {
                isRoot: true
            }
        })

        // Members Team. 
        const memberTeam = new Team();
        memberTeam.projectId = createdItem.data.id!;
        memberTeam.isPermissionsEditable = false;
        memberTeam.name = "Members";
        memberTeam.isTeamDeleteable = false; 
        memberTeam.description = "This team is for project members. Members can interact with any project resources like monitors, incidents, etc.";
 
        await TeamService.create({
            data: memberTeam,
            props: {
                isRoot: true
            }
        })

        let memberPermissions: TeamPermission = new TeamPermission();
        memberPermissions.permission = Permission.ProjectMember;
        memberPermissions.teamId = ownerTeam.id!;
        memberPermissions.projectId = createdItem.data.id!

        await TeamPermissionService.create({
            data: memberPermissions, 
            props: {
                isRoot: true
            }
        })

       


        return Promise.resolve(createdItem);
    }
}
export default new Service();
