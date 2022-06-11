import AppEnvironment from '../../Types/AppEnvironment';
describe('AppEnvironment', () => {
    test('AppEnvironment.Production should be prodoction', () => {
        expect(AppEnvironment.Production).toEqual('production');
    });
    test('AppEnvironment.Developemnt should be prodoction', () => {
        expect(AppEnvironment.Development).toEqual('development');
    });
    test('AppEnvironment.Test should be test', () => {
        expect(AppEnvironment.Test).toEqual('test');
    });
});
