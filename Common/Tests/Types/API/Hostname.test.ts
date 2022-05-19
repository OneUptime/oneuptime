import Hostname from '../../../Types/API/Hostname';
import BadDataException from '../../../Types/Exception/BadDataException';
describe('Hostname', () => {
    test('new Hostname(hostname) should throw an error if invalid hostname is given', () => {
        expect(() => {
            return new Hostname('undefined undefined');
        }).toThrowError(BadDataException);
        expect(() => {
            return new Hostname('localhost 5000');
        }).toThrow(BadDataException);
        expect(() => {
            new Hostname('localhost:5000').hostname = 'localhost 6000';
        }).toThrow(BadDataException);
    });
    test('new Hostname(hostname) should return a valid object', () => {
        const hostnameObject: Hostname = new Hostname('localhost:5000');
        expect(hostnameObject.hostname).toBeTruthy();
        expect(hostnameObject.hostname).toBe('localhost:5000');
        expect(hostnameObject.toString()).toBe('localhost:5000');
    });
});
