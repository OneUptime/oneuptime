import Role, { RoleArray } from '../../Types/Role';

const expectedFields: Array<keyof typeof Role> = [
    'Owner',
    'Administrator',
    'Member',
    'Viewer',
    'CanManageProjectBilling',
    'CanCreateProjectTeam',
    'CanEditProjectTeam',
    'CanDeleteProjectTeam',
    'CanCreateProjectLabel',
    'CanEditProjectLabel',
    'CanDeleteProjectLabel',
    'CanCreateProjectResources',
    'CanEditProjectResources',
    'CanDeleteProjectResources',
    'User',
    'Public',
];

describe('Role', () => {
    test.each(expectedFields)('Role has %s', (field: keyof typeof Role) => {
        expect(Role[field]).toBe(field);
    });
});

describe('RoleArray', () => {
    test('has Role fields', () => {
        expect(RoleArray).toEqual(expectedFields);
    });
});
