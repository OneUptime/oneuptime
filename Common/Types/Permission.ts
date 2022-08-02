// Have "Project" string in the permission to make sure this permission is by Project.

import BadDataException from './Exception/BadDataException';
import { JSONObject } from './JSON';
import ObjectID from './ObjectID';


export interface PermissionProps {
    permission: Permission;
    description: string;
    isAssignableToProject: boolean;
    title: string; 
}

enum Permission {
    // Owner of a Project
    ProjectOwner = 'ProjectOwner',

    // Project Admin
    ProjectAdmin = 'ProjectAdmin',

    ProjectMember = 'ProjectMember', // member of a project

    User = 'User', //registered user. Can or cannot belong to a project.

    CurrentUser = 'CurrentUser', // Current logged in user.

    CustomerSupport = 'CustomerSupport', // Customer Support for OneUptime.

    Public = 'Public', // non-registered user. Everyone has this permission.

    // Billing Permissions (Owner Permission)
    CanDeleteProject = 'CanDeleteProject',
    CanUpdateProject = 'CanDeleteProject',

    // Billing Permissions (Owner Permission)
    CanCreateProjectApiKey = 'CanCreateProjectApiKey',
    CanDeleteProjectApiKey = 'CanDeleteProjectApiKey',
    CanReadProjectApiKey = 'CanReadProjectApiKey',
    CanEditProjectApiKey = 'CanEditProjectApiKey',
    CanEditProjectApiKeyPermissions = 'CanEditProjectApiKeyPermissions',

    // Billing Permissions (Owner Permission)
    CanManageProjectBilling = 'CanManageProjectBilling',

    // Billing Permissions (Owner Permission)
    CanCreateProjectTeam = 'CanCreateProjectTeam',
    CanDeleteProjectTeam = 'CanDeleteProjectTeam',
    CanReadProjectTeam = 'CanReadProjectTeam',
    CanEditProjectTeam = 'CanEditProjectTeam',
    CanInviteProjectTeamMembers = 'CanInviteProjectTeamMembers',
    CanEditProjectTeamPermissions = 'CanEditProjectTeamPermissions',

    // Probe Permissions (Owner Permission)
    CanCreateProjectProbe = 'CanCreateProjectProbe',
    CanDeleteProjectProbe = 'CanDeleteProjectProbe',
    CanEditProjectProbe = 'CanEditProjectProbe',
    CanReadProjectProbe = 'CanReadProjectProbe',

    // Label Permissions (Owner + Admin Permission by default)
    CanCreateProjectLabel = 'CanCreateProjectLabel',
    CanEditProjectLabel = 'CanEditProjectLabel',
    CanReadProjectLabel = 'CanReadProjectLabel',
    CanDeleteProjectLabel = 'CanDeleteProjectLabel',
    CanAddLabelsToProjectResources = 'CanAddLabelsToProjectResources',

    // Resource Permissions (Team Permission)
    CanCreateProjectResources = 'CanCreateProjectResources',
    CanEditProjectResources = 'CanEditProjectResources',
    CanDeleteProjectResources = 'CanDeleteProjectResources',
    CanReadProjectResources = 'CanReadProjectResources',


    // Project SMTP Config (Team Permission)
    CanCreateProjectSMTPConfig = 'CanCreateProjectSMTPConfig',
    CanEditProjectSMTPConfig = 'CanEditProjectSMTPConfig',
    CanDeleteProjectSMTPConfig = 'CanDeleteProjectSMTPConfig',
    CanReadProjectSMTPConfig = 'CanReadProjectSMTPConfig',
}

export class PermissionHelper {

    public static doesPermissionsIntersect(
        permissions1: Array<Permission>,
        permissions2: Array<Permission>
    ): boolean {
        return (
            permissions1.filter((value: Permission) => {
                return permissions2.includes(value);
            }).length > 0
        );
    }

    public static getProjectPermissionProps(): Array<PermissionProps> {
        return this.getAllPermissionProps().filter((item: PermissionProps) => {
            return item.isAssignableToProject;
        })
    }

    public static getDescription(permission: Permission): string {
        const permissionProps: Array<PermissionProps> = this.getAllPermissionProps().filter((item: PermissionProps) => {
            return item.permission === permission
        });

        if (!permissionProps[0]) {
            throw new BadDataException(`${permission} does not have permission props`);
        }

        return permissionProps[0].description;
    }

    public static getTitle(permission: Permission): string {
        const permissionProps: Array<PermissionProps> = this.getAllPermissionProps().filter((item: PermissionProps) => {
            return item.permission === permission
        });

        if (!permissionProps[0]) {
            throw new BadDataException(`${permission} does not have permission props`);
        }

        return permissionProps[0].title;
    }

    public static getAllPermissionProps(): Array<PermissionProps> {

        const permissions: Array<PermissionProps> = [
            {
                permission: Permission.ProjectOwner,
                title: 'Project Owner',
                description: 'Owner of this project, manages billing, inviting other admins to this project, and can delete this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.ProjectAdmin,
                title: 'Project Admin',
                description: 'Owner of this project, manages billing, inviting other admins to this project, and can delete this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CurrentUser,
                title: 'Current User',
                description: 'Owner of this project, manages billing, inviting other admins to this project, and can delete this project.',
                isAssignableToProject: false
            },
            {
                permission: Permission.CustomerSupport,
                title: 'Customer Support',
                description: 'Customer Support Resource of OneUptime.',
                isAssignableToProject: false
            },
            {
                permission: Permission.User,
                title: 'User',
                description: 'Owner of this project, manages billing, inviting other admins to this project, and can delete this project.',
                isAssignableToProject: false
            },
            {
                permission: Permission.Public,
                title: 'Public',
                description: 'Non registered user. Typically used for sign up or log in.',
                isAssignableToProject: false
            },
            {
                permission: Permission.CanDeleteProject,
                title: 'Can Delete Project',
                description: 'A user assigned this permission can delete this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanUpdateProject,
                title: 'Can Update Project',
                description: 'A user assigned this permission can update this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanManageProjectBilling,
                title: 'Can Manage Billing',
                description: 'A user assigned this permission can update project billing.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanCreateProjectApiKey,
                title: 'Can Create API Key',
                description: 'A user assigned this permission can create api keys of this project',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanDeleteProjectApiKey,
                title: 'Can Delete API Key',
                description: 'A user assigned this permission  can delete api keys of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanEditProjectApiKeyPermissions,
                title: 'Can Edit API Key Permissions',
                description: 'A user assigned this permission  can edit api key permissions of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanEditProjectApiKey,
                title: 'Can Edit API Key',
                description: 'A user assigned this permission can edit api keys of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanReadProjectApiKey,
                title: 'Can Read API Key',
                description: 'A user assigned this permission  can read api keys of this project.',
                isAssignableToProject: true
            },

            {
                permission: Permission.CanCreateProjectLabel,
                title: 'Can Create Label',
                description: 'A user assigned this permission can create labels this this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanDeleteProjectLabel,
                title: 'Can Delete Label',
                description: 'A user assigned this permission  can delete labels of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanAddLabelsToProjectResources,
                title: 'Can Add Label to Resources',
                description: 'A user assigned this permission can add project labels to resources of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanEditProjectLabel,
                title: 'Can Edit Label',
                description: 'A user assigned this permission can edit labels of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanReadProjectLabel,
                title: 'Can Read Label',
                description: 'A user assigned this permission  can read labels of this project.',
                isAssignableToProject: true
            },


            {
                permission: Permission.CanCreateProjectSMTPConfig,
                title: 'Can Create SMTP Config',
                description: 'A user assigned this permission can create SMTP configs this this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanDeleteProjectSMTPConfig,
                title: 'Can Delete SMTP Config',
                description: 'A user assigned this permission  can delete SMTP configs of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanEditProjectSMTPConfig,
                title: 'Can Edit SMTP Config',
                description: 'A user assigned this permission can edit SMTP configs of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanReadProjectSMTPConfig,
                title: 'Can Read SMTP Config',
                description: 'A user assigned this permission  can read SMTP configs of this project.',
                isAssignableToProject: true
            },


            {
                permission: Permission.CanCreateProjectTeam,
                title: 'Can Create Team',
                description: 'A user assigned this permission can create teams this this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanDeleteProjectTeam,
                title: 'Can Delete Team',
                description: 'A user assigned this permission  can delete teams of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanInviteProjectTeamMembers,
                title: 'Can Invite New Members',
                description: 'A user assigned this permission can inivte users to the team.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanEditProjectTeamPermissions,
                title: 'Can Edit Team Permissions',
                description: 'A user assigned this permission can edit team permissions of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanEditProjectTeam,
                title: 'Can Edit Team',
                description: 'A user assigned this permission can edit teams of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanReadProjectTeam,
                title: 'Can Read Teams',
                description: 'A user assigned this permission  can read teams of this project.',
                isAssignableToProject: true
            },


            {
                permission: Permission.CanCreateProjectResources,
                title: 'Can Create Resources',
                description: 'A user assigned this permission can create resources this this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanDeleteProjectResources,
                title: 'Can Delete Resources',
                description: 'A user assigned this permission  can delete resources of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanEditProjectResources,
                title: 'Can Edit Resources',
                description: 'A user assigned this permission can edit resources of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanReadProjectResources,
                title: 'Can Read Resources',
                description: 'A user assigned this permission  can read resources of this project.',
                isAssignableToProject: true
            },

            {
                permission: Permission.CanCreateProjectProbe,
                title: 'Can Create Probe',
                description: 'A user assigned this permission can create probe this this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanDeleteProjectProbe,
                title: 'Can Delete Probe',
                description: 'A user assigned this permission  can delete probe of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanEditProjectProbe,
                title: 'Can Edit Probe',
                description: 'A user assigned this permission can edit probe of this project.',
                isAssignableToProject: true
            },
            {
                permission: Permission.CanReadProjectProbe,
                title: 'Can Read Probe',
                description: 'A user assigned this permission  can read probe of this project.',
                isAssignableToProject: true
            },
        ];

        return permissions;

    }

}

export interface UserGlobalAccessPermission extends JSONObject {
    projectIds: Array<ObjectID>;
    globalPermissions: Array<Permission>;
}

export interface UserPermission extends JSONObject {
    permission: Permission;
    labelIds: Array<ObjectID>;
}

export interface UserProjectAccessPermission extends JSONObject {
    projectId: ObjectID;
    permissions: Array<UserPermission>;
}

export const PermissionsArray: Array<string> = [
    ...new Set(Object.keys(Permission)),
]; // Returns ["Owner", "Administrator"...]

export default Permission;
