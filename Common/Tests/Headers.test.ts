import Headers from '../Types/API/Headers';
describe('Headers', () => {
    test('should compile', () => {
        const headers: Headers = {
            accept: 'application/json',
            'x-api-number': '2',
        };
        expect(headers).toBeTruthy();
    });
});
