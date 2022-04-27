import Route from '../Types/API/Route';
describe('Route', () => {
    test('new Route should return a create object', () => {
        const route: Route = new Route('/api/test');
        expect(route.route).toBe('/api/test');
    });
    test('Route.toString() should return valid string', () => {
        const route: Route = new Route('/api/test');
        expect(route.toString()).toBe('/api/test');
    });
});
