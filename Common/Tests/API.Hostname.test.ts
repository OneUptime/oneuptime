import Hostname from '../Types/API/Hostname';
import BadDataException from '../Types/Exception/BadDataException';
describe('Hostname', () => {
    type createHostnameType = (route: string) => () => Hostname;
    const createHostname: createHostnameType = (route: string) => {
        return () => {
            return new Hostname(route);
        };
    };
    test('new Hostname(hostname) should throw an error if invalid hostname is given', () => {
        expect(createHostname('undefined undefined')).toThrowError(
            BadDataException
        );
        expect(createHostname('localhost 5000')).toThrow(BadDataException);
    });
    test('new Hostname(hostname) should return a valid object', () => {
        const hostnameObject: Hostname = new Hostname('localhost:5000');
        expect(hostnameObject.hostname).toBeTruthy();
        expect(hostnameObject.hostname).toBe('localhost:5000');
        expect(hostnameObject.toString()).toBe('localhost:5000');
    });
});
