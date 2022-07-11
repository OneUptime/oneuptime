enum PermissionDescription {
    // Owner of a Project
    ProjectOwner = 'ProjectOwner',

    AnyMember = 'AnyMember', // member of a project

    AnyUser = 'AnyUser', //registered user. Can or cannot belong to a project.

    CurrentUser = 'CurrentUser', // Current logged in user.

    CustomerSupport = 'CustomerSupport', // Customer Support for OneUptime.

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

export default PermissionDescription;
