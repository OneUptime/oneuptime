import Permission from '../../Types/Permission';

describe('Permission', () => {
    test('Permission.ProjectMember should be ProjectMember', () => {
        expect(Permission.ProjectMember).toBe('ProjectMember');
    });

    test('Permission.Public should be Public', () => {
        expect(Permission.Public).toBe('Public');
    });
});
