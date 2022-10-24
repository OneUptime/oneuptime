import UserType from "../../Types/UserType";

describe('enum UserType',() =>{

    test('UserType.API should be API', () => {
        expect(UserType.API).toEqual('API');
    });
    test('UserType.User should be User', () => {
        expect(UserType.User).toEqual('User');
    });
    test('UserType.MasterAdmin should be MasterAdmin', () => {
        expect(UserType.MasterAdmin).toEqual('MasterAdmin');
    });
    test('UserType.Public should be Public', () => {
        expect(UserType.Public).toEqual('Public');
    });
})