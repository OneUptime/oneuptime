enum Role {
    Owner = 'Owner', // owner of a project. An owner owns all the billing info.
    Administrator = 'Administrator', // admin of a project
    Member = 'Member', // member of a project
    Viewer = 'Viewer', // user who is a viewer in a project
    User = 'User', // registered-user but does not belong to a project
    Public = 'Public', // non-registered user.
}

export const RoleArray: Array<string> = [...new Set(Object.keys(Role))]; // Returns ["Owner", "Administrator"...]

export default Role;
