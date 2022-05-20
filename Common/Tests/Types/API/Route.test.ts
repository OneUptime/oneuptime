import Route from '../../../Types/API/Route';
import BadDataException from '../../../Types/Exception/BadDataException';
describe('Route', () => {
    test('new Route() should throw an error if invalid route is passed', () => {
        expect(() => {
            return new Route('api test');
        }).toThrowError(BadDataException);
        expect(() => {
            return new Route('api\test');
        }).toThrowError(BadDataException);
        expect(() => {
            return new Route('api`test');
        }).toThrowError(BadDataException);
        expect(() => {
            return new Route('/api|test');
        }).toThrowError(BadDataException);
    });
    test('new Route() should throw an error if invalid route is passed', () => {
        const route: Route = new Route('/api/test');
        expect(() => {
            route.route = 'api`test';
        }).toThrowError(BadDataException);
    });
    test('Route.toString() should return valid string', () => {
        expect(new Route('/api/test').toString()).toBe('/api/test');
        expect(new Route('/api#test').toString()).toBe('/api#test');
    });
});
