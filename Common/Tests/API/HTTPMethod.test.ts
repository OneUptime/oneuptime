import HTTPMethod from '../../Types/API/HTTPMethod';

describe('HTTPMethod', () => {
    test('HTTPMethod.GET should be GET', () => {
        expect(HTTPMethod.GET).toBe('GET');
    });
    test('HTTPMethod.POST should be POST', () => {
        expect(HTTPMethod.POST).toBe('POST');
    });
    test('HTTPMethod.PUT should be PUT', () => {
        expect(HTTPMethod.PUT).toBe('PUT');
    });
    test('HTTPMethod.DELETE should be DELETE', () => {
        expect(HTTPMethod.DELETE).toBe('DELETE');
    });
});
