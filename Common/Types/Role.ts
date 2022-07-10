enum Role {
    Owner = 'Owner', // owner of a project. An owner owns all the billing info.
    Administrator = 'Administrator', // admin of a project
    Member = 'Member', // member of a project
    Viewer = 'Viewer', // user who is a viewer in a project

    // Billing Permissions (Owner Permission)
    CanManageBilling = 'CanManageBilling',

    // Billing Permissions (Owner + Admin Permission)
    CanCreateTeam = 'CanCreateTeam',
    CanEditTeam = 'CanEditTeam',
    CanDeleteTeam = 'CanDeleteTeam',

    // Label Permissions (Owner + Admin Permission by default)
    CanCreateLabel = 'CanCreateLabel',
    CanEditLabel = 'CanEditLabel',
    CanDeleteLabel = 'CanDeleteLabel',

    // Resource Permissions (Team Permission)
    CanCreateResources = 'CanCreateResources',
    CanEditResources = 'CanEditResources',
    CanDeleteResources = 'CanDeleteResources',

    User = 'User', //registered user.

    Public = 'Public', // non-registered user.
}

export const RoleArray: Array<string> = [...new Set(Object.keys(Role))]; // Returns ["Owner", "Administrator"...]

export default Role;
