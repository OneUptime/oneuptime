import Response from '../Types/API/Response';
describe('Response()', () => {
    test('should return a valid response object', () => {
        let responseObject: Response;
        responseObject = new Response(200, { welcome: 'here' });
        expect(responseObject.statusCode).toBe(200);
        expect(responseObject.data).toEqual({ welcome: 'here' });
        responseObject = new Response(200, [{ welcome: 'here' }]);
        expect(responseObject.statusCode).toBe(200);
        expect(responseObject.data).toEqual([{ welcome: 'here' }]);
    });
});
