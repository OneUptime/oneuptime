enum Permission {

    // Owner of a Project
    ProjectOwner = 'ProjectOwner',

    AnyMember = 'AnyMember', // member of a project

    AnyUser = 'AnyUser', //registered user. Can or cannot belong to a project.

    CurrentUser = 'CurrentUser', // Current logged in user. 

    CustomerSupport = 'CustomerSupport', // Customer Support for OneUptime. 

    Public = 'Public', // non-registered user. Everyone has this permission.

    // Billing Permissions (Owner Permission)
    CanDeleteProject = 'CanDeleteProject',
    CanUpdateProject = 'CanDeleteProject',

    // Billing Permissions (Owner Permission)
    CanCreateApiKey = 'CanCreateApiKey',
    CanDeleteApiKey = 'CanDeleteApiKey',
    CanReadApiKey = 'CanReadApiKey',
    CanEditApiKey = 'CanEditApiKey',
    CanEditApiKeyPermissions = 'CanEditApiKeyPermissions',

    // Billing Permissions (Owner Permission)
    CanManageBilling = 'CanManageBilling',

    // Billing Permissions (Owner Permission)
    CanCreateTeam = 'CanCreateTeam',
    CanDeleteTeam = 'CanDeleteTeam',
    CanReadTeam = 'CanReadTeam',
    CanEditTeam = 'CanEditTeam',
    CanInviteTeamMembers = 'CanInviteTeamMembers',
    CanEditTeamPermissions = 'CanEditTeamPermissions',

    // Probe Permissions (Owner Permission)
    CanCreateProbe = 'CanCreateProbe',
    CanDeleteProbe = 'CanDeleteProbe',
    CanEditProbe = 'CanEditProbe',

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
}

export const PermissionsArray: Array<string> = [
    ...new Set(Object.keys(Permissions)),
]; // Returns ["Owner", "Administrator"...]

export default Permission;
