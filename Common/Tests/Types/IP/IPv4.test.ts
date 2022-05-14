import IP from '../../../Types/IP/IPv4';

describe('IPv4()', () => {
    let ip: IP;
    beforeEach(() => {
        ip = new IP('196.223.149.8');
    });

    test('should be IPv4', () => {
        expect(ip.isIPv4()).toBeTruthy();
    });

    test('should not be IPv6', () => {
        expect(() => {
            ip.isIPv6();
        }).toThrow();
    });
});
