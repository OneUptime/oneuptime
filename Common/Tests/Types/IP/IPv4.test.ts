import IP from '../../../Types/IP/IPv4';

describe('IPv4()', () => {
    test('should be IPv4', () => {
        const ip: IP = new IP('196.223.149.8');
        expect(ip.isIPv4()).toBeTruthy();
    });

    test('should not be IPv6', () => {
        const ip: IP = new IP('196.223.149.8');
        expect(() => {
            ip.isIPv6();
        }).toThrow();
    });

    test('Is not a valid IPv4 address', () => {
        const ip: IP = new IP('Invalid IP');
        expect(() => {
            ip.isIPv4();
        }).toThrow();
    });
});
