import IP from '../../../Types/IP/IP';
import IPType from '../../../Types/IP/IPType';

describe('IP()', () => {
    test('expect ip to be defined', () => {
        const ip: IP = new IP('196.223.149.8', IPType.IPv4);
        expect(ip.toString()).toBe('196.223.149.8');
    });

    test('expects type of ip to be a string', () => {
        const ip: IP = new IP('196.223.149.8', IPType.IPv4);
        expect(typeof ip.toString()).toBe('string');
    });

    test('expects ip address to be mutable', () => {
        const ip: IP = new IP('196.223.149.8', IPType.IPv4);
        const newIp: string = '127.0.0.1';
        ip.ip = newIp;
        expect(ip.ip).not.toBe('196.223.149.8');
        expect(ip.ip).toBe('127.0.0.1');
    });

    test('expects ip address to be 127.0.0.1', () => {
        const ip: IP = new IP('196.223.149.8', IPType.IPv4);
        const newIp: string = '127.0.0.1';
        ip.ip = newIp;
        expect(ip.ip).toBe('127.0.0.1');
    });

    test('is valid IPv6 address', () => {
        const ip: IP = new IP('::11.22.33.44', IPType.IPv6);
        expect(ip.isIPv6()).toBeTruthy();
    });

    test('should throw an error for invalid IP', () => {
        expect(() => {
            new IP('', IPType.IPv4);
        }).toThrow('IP is not a valid IPv4 address');
    });
});
