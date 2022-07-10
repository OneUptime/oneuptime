enum Permission {

    // Root 
    Root = 'ROOT', // System Permission. Should not be assigned to any user. 

    // Owner of a Project
    ProjectOwner = 'ProjectOwner',

    Member = 'Member', // member of a project

    User = 'User', //registered user. Can or cannot belong to a project.

    Public = 'Public', // non-registered user. Everyone has this permission. 

    // Billing Permissions (Owner Permission)
    CanDeleteProject = 'CanDeleteProject',

    // Billing Permissions (Owner Permission)
    CanCreateApiKey = 'CanCreateApiKey',
    CanDeleteApiKey = 'CanDeleteApiKey',
    CanReadApiKey = 'CanReadApiKey',
    CanEditApiKeyPermissions = 'CanEditApiKeyPermissions',

    // Billing Permissions (Owner Permission)
    CanManageBilling = 'CanManageBilling',

    // Billing Permissions (Owner Permission)
    CanCreateTeam = 'CanCreateTeam',
    CanDeleteTeam = 'CanDeleteTeam',
    CanReadTeam = 'CanReadTeam',
    CanEditTeamPermissions = 'CanEditTeamPermissions',

    CanInviteTeamMembers = 'CanEditTeam', // Owner + Admin can have this permission. 

    // Label Permissions (Owner + Admin Permission by default)
    CanCreateLabel = 'CanCreateLabel',
    CanEditLabel = 'CanEditLabel',
    CanReadLabel = 'CanReadLabel',
    CanDeleteLabel = 'CanDeleteLabel',
    CanAddLabelsToResources = 'CanAddLabelsToResources',

    // Resource Permissions (Team Permission)
    CanCreateResources = 'CanCreateResources',
    CanEditResources = 'CanEditResources',
    CanDeleteResources = 'CanDeleteResources',
    CanReadResources = 'CanReadResources',
}

export class PermissionUtil {
    public static doesPermissionsIntersect(permissions1: Array<Permission>, permissions2: Array<Permission>): boolean {
        return permissions1.filter(value => permissions2.includes(value)).length > 0;
    }
}

export const PermissionsArray: Array<string> = [...new Set(Object.keys(Permissions))]; // Returns ["Owner", "Administrator"...]

export default Permission;
