import Permission from '../../Types/Permission';

describe('Permission', () => {
    test('Permission.AnyMember should be Member', () => {
        expect(Permission.AnyMember).toBe('Member');
    });

    test('Permission.Public should be Public', () => {
        expect(Permission.Public).toBe('Public');
    });
});
