import IP from '../../../Types/IP/IPv4';

describe('IPv4()', () => {
    test('should be IPv4', () => {
        const ip: IP = new IP('196.223.149.8');
        expect(ip.isIPv4()).toBeTruthy();
    });

    test('should not be IPv6', () => {
        const ip: IP = new IP('196.223.149.8');
        expect(ip.isIPv6()).toBeFalsy();
    });

    test('Is not a valid address', () => {
        expect(() => {
            new IP('Invalid IP');
        }).toThrow();
    });
});
