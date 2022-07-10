import Permission from '../../Types/Permission';

describe('Permission', () => {

    test('Permission.Member should be Member', () => {
        expect(Permission.Member).toBe('Member');
    });
    
    test('Permission.Public should be Public', () => {
        expect(Permission.Public).toBe('Public');
    });
});
