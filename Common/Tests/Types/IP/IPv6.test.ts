import IP from '../../../Types/IP/IPv6';

describe('IPv6()', () => {
    let ip: IP;
    beforeEach(() => {
        ip = new IP('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    });

    test('should be IPv6', () => {
        expect(ip.isIPv6()).toBeTruthy();
    });

    test('should not be IPv4', () => {
        expect(() => {
            ip.isIPv4();
        }).toThrow();
    });
});
