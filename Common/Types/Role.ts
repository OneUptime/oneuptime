enum Role {
    Owner = 'Owner',
    Administrator = 'Administrator',
    Member = 'Member',
    Viewer = 'Viewer',
}

export const RoleArray: Array<string> = [...new Set(Object.keys(Role))]; // Returns ["Owner", "Administrator"...]

export default Role;
