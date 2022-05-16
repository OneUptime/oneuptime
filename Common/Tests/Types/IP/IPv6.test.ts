import IP from '../../../Types/IP/IPv6';

describe('IPv6()', () => {
    test('should be IPv6', () => {
        const ip: IP = new IP('2001:0db8:85a3:::8a2e:0370:7334');
        expect(ip.isIPv6(ip.toString())).toBeTruthy();
    });

    test('should not be IPv4', () => {
        const ip: IP = new IP('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
        expect(ip.isIPv4(ip.toString())).toBeFalsy();
    });

    test('Is not a valid address', () => {
        expect(() => {
            new IP('Invalid Ip');
        }).toThrow('IP is not a valid IPv6 address');
    });
});
