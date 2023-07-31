import AppEnvironment from '../../Types/AppEnvironment';
describe('AppEnvironment', () => {
    test('AppEnvironment.Production should be production', () => {
        expect(AppEnvironment.Production).toEqual('production');
    });
    test('AppEnvironment.Development should be production', () => {
        expect(AppEnvironment.Development).toEqual('development');
    });
    test('AppEnvironment.Test should be test', () => {
        expect(AppEnvironment.Test).toEqual('test');
    });
});
