enum Permissions {

    Owner = 'Owner', // owner of a project. An owner owns all the billing info.
    Administrator = 'Administrator', // admin of a project
    Member = 'Member', // member of a project
    Viewer = 'Viewer', // user who is a viewer in a project

    // Billing Permissions (Owner Permission)
    CanDeleteProject = 'CanDeleteProject',

    // Billing Permissions (Owner Permission)
    CanManageBilling = 'CanManageBilling',

    // Billing Permissions (Owner Permission)
    CanCreateTeam = 'CanCreateTeam',
    CanDeleteTeam = 'CanDeleteTeam',
    CanEditTeamPermissions = 'CanEditTeamPermissions',

    CanInviteTeamMembers = 'CanEditTeam', // Owner + Admin can have this permission. 

    // Label Permissions (Owner + Admin Permission by default)
    CanCreateLabel = 'CanCreateLabel',
    CanEditLabel = 'CanEditLabel',
    CanDeleteLabel = 'CanDeleteLabel',
    CanAddLabelsToResources = 'CanAddLabelsToResources',

    // Resource Permissions (Team Permission)
    CanCreateResources = 'CanCreateResources',
    CanEditResources = 'CanEditResources',
    CanDeleteResources = 'CanDeleteResources',
    

    User = 'User', //registered user. Only registered user have this permission.

    Public = 'Public', // non-registered user. Everyone has this permission. 

}

export const PermissionsArray: Array<string> = [...new Set(Object.keys(Permissions))]; // Returns ["Owner", "Administrator"...]

export default Permissions;
