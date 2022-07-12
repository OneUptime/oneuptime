import Permission from '../../Types/Permission';

describe('Permission', () => {
    test('Permission.AnyProjectMember should be AnyProjectMember', () => {
        expect(Permission.AnyProjectMember).toBe('AnyProjectMember');
    });

    test('Permission.Public should be Public', () => {
        expect(Permission.Public).toBe('Public');
    });
});
