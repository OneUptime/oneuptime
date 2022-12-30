enum Role {
    Owner = 'Owner', // owner of a project. An owner owns all the billing info.
    Administrator = 'Administrator', // admin of a project
    Member = 'Member', // member of a project
    Viewer = 'Viewer', // user who is a viewer in a project

    // Billing Permissions (Owner Permission)
    CanManageProjectBilling = 'CanManageProjectBilling',

    // Billing Permissions (Owner + Admin Permission)
    CanCreateProjectTeam = 'CanCreateProjectTeam',
    CanEditProjectTeam = 'CanEditProjectTeam',
    CanDeleteProjectTeam = 'CanDeleteProjectTeam',

    // Label Permissions (Owner + Admin Permission by default)
    CanCreateProjectLabel = 'CanCreateProjectLabel',
    CanEditProjectLabel = 'CanEditProjectLabel',
    CanDeleteProjectLabel = 'CanDeleteProjectLabel',

    // Resource Permissions (Team Permission)
    CanCreateProjectResources = 'CanCreateProjectResources',
    CanEditProjectResources = 'CanEditProjectResources',
    CanDeleteProjectResources = 'CanDeleteProjectResources',

    User = 'User', //registered user.

    Public = 'Public', // non-registered user.
}

export const RoleArray: Array<string> = [...new Set(Object.keys(Role))]; // Returns ["Owner", "Administrator"...]

export default Role;
