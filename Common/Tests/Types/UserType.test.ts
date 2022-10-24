import UserType from '../../Types/UserType';

describe('enum UserType', () => {
    test('each user type should have a corresponding type', () => {
        expect(UserType['API']).toEqual('API');
        expect(UserType['User']).toEqual('User');
        expect(UserType['MasterAdmin']).toEqual('MasterAdmin');
        expect(UserType['Public']).toEqual('Public');
    });
});
