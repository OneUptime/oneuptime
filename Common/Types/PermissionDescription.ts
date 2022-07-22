enum PermissionDescription {
    // Owner of a Project
    ProjectOwner = 'ProjectOwner',

    ProjectMember = 'ProjectMember', // member of a project

    User = 'User', //registered user. Can or cannot belong to a project.

    CurrentUser = 'CurrentUser', // Current logged in user.

    CustomerSupport = 'CustomerSupport', // Customer Support for OneUptime.

    Public = 'Public', // non-registered user. Everyone has this permission.

    // Billing Permissions (Owner Permission)
    CanDeleteProject = 'CanDeleteProject',

    // Billing Permissions (Owner Permission)
    CanCreateProjectApiKey = 'CanCreateProjectApiKey',
    CanDeleteProjectApiKey = 'CanDeleteProjectApiKey',
    CanReadProjectApiKey = 'CanReadProjectApiKey',
    CanEditProjectApiKeyPermissions = 'CanEditProjectApiKeyPermissions',

    // Billing Permissions (Owner Permission)
    CanManageProjectBilling = 'CanManageProjectBilling',

    // Billing Permissions (Owner Permission)
    CanCreateProjectTeam = 'CanCreateProjectTeam',
    CanDeleteProjectTeam = 'CanDeleteProjectTeam',
    CanReadProjectTeam = 'CanReadProjectTeam',
    CanEditProjectTeamPermissions = 'CanEditProjectTeamPermissions',

    CanInviteProjectTeamMembers = 'CanEditProjectTeam', // Owner + Admin can have this permission.

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
}

export default PermissionDescription;
