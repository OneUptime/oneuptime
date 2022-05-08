import Hostname from '../Types/API/Hostname';
describe('Hostname', () => {
    test('new Hostname(hostname) should return a valid object', () => {
        const hostnameObject: Hostname = new Hostname('localhost:5000');
        expect(hostnameObject.hostname).toBeTruthy();
        expect(hostnameObject.hostname).toBe('localhost:5000');
    });
});
