import Route from '../Types/API/Route';
import BadDataException from '../Types/Exception/BadDataException';
describe('Route', () => {
    type createRouteType = (route: string) => () => Route;
    const createRoute: createRouteType = (route: string) => {
        return () => {
            return new Route(route);
        };
    };
    test('new Route() should throw an error if invalid route is passed', () => {
        expect(createRoute('api test')).toThrowError(BadDataException);
        expect(createRoute('api\test')).toThrowError(BadDataException);
        expect(createRoute('api`test')).toThrowError(BadDataException);
        expect(createRoute('/api|test')).toThrowError(BadDataException);
    });
    test('Route.toString() should return valid string', () => {
        expect(createRoute('/api/test')().toString()).toBe('/api/test');
        expect(createRoute('/api#test')().toString()).toBe('/api#test');
    });
});
