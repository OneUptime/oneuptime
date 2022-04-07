enum Role {
    Owner = 'Owner',
    Administrator = 'Administrator',
    Member = 'Member',
    Viewer = 'Viewer',
}

export const RoleArray: Array<string> = [...new Set(Object.keys(Role))]; // returns ["Owner", "Administrator"...]

export default Role;
