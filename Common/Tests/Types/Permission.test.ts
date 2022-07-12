import Permission from '../../Types/Permission';

describe('Permission', () => {
    test('Permission.AnyMember should be AnyMember', () => {
        expect(Permission.AnyMember).toBe('AnyMember');
    });

    test('Permission.Public should be Public', () => {
        expect(Permission.Public).toBe('Public');
    });
});
