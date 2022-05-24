import Role from '../../Types/Role';

describe('Role', () => {
    test('Role.Owner should be Owner', () => {
        expect(Role.Owner).toBe('Owner');
    });
    test('Role.Administrator should be Administrator', () => {
        expect(Role.Administrator).toBe('Administrator');
    });

    test('Role.Member should be Member', () => {
        expect(Role.Member).toBe('Member');
    });
    test('Role.Viewer should be Viewer', () => {
        expect(Role.Viewer).toBe('Viewer');
    });
    test('Role.Public should be Public', () => {
        expect(Role.Public).toBe('Public');
    });
});
