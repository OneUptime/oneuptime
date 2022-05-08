import Headers from '../Types/API/Headers';
describe('Headers', () => {
    test('should compile', () => {
        const headers: Headers = {
            accept: 'application/json',
            'x-api-limit': '2',
        };
        expect(headers).toBeTruthy();
        expect(headers['accept']).toBe('application/json');
        expect(headers['x-api-limit']).toBe('2');
        expect(headers['undefined']).toBe(undefined);
    });
});
