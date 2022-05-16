import IP from '../../../Types/IP/IP';

enum IPType {
    IPv4 = 'IPv4',
    IPv6 = 'IPv6',
}

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

    test('should throw an error when isIPv4() is called', () => {
        const ip: IP = new IP('196.223.149.8', IPType.IPv4);
        expect(() => {
            ip.isIPv4();
        }).toThrow('This code is not implemented');
    });

    test('should throw an error when isIPv6() is called', () => {
        const ip: IP = new IP('196.223.149.8', IPType.IPv4);
        expect(() => {
            ip.isIPv6();
        }).toThrow('This code is not implemented');
    });
});
