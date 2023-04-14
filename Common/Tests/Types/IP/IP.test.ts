import IP from '../../../Types/IP/IP';

describe('IP()', () => {
    test('expect ip to be defined', () => {
        const ip: IP = new IP('196.223.149.8');
        expect(ip.toString()).toBe('196.223.149.8');
    });

    test('expects type of ip to be a string', () => {
        const ip: IP = new IP('196.223.149.8');
        expect(typeof ip.toString()).toBe('string');
    });

    test('expects ip address to be mutable', () => {
        const ip: IP = new IP('196.223.149.8');
        const newIp: string = '127.0.0.1';
        ip.ip = newIp;
        expect(ip.ip).not.toBe('196.223.149.8');
        expect(ip.ip).toBe('127.0.0.1');
    });

    test('expects ip address to be 127.0.0.1', () => {
        const ip: IP = new IP('196.223.149.8');
        const newIp: string = '127.0.0.1';
        ip.ip = newIp;
        expect(ip.ip).toBe('127.0.0.1');
    });

    test('is valid IPv6 address', () => {
        const ip: IP = new IP('::11.22.33.44');
        expect(ip.isIPv6()).toBeTruthy();
    });

    test('should throw an error for invalid IP', () => {
        expect(() => {
            new IP('');
        }).toThrow('IP is not a valid address');
    });

    test('should return a string', () => {
        expect(IP.toDatabase('127.0.0.1')).toBe('127.0.0.1');
    });

    test('should return null', () => {
        expect(IP.toDatabase('')).toBeNull();
    });

    test('should be an instance IP', () => {
        expect(IP.fromDatabase('127.0.0.1')).toBeInstanceOf(IP);
    });

    test('should not create an instance of IP', () => {
        expect(IP.fromDatabase('')).toBeNull();
    });

    test('should create an IP of type IPv4 from database', () => {
        expect(IP.fromDatabase('127.0.0.1')?.isIPv4()).toBeTruthy();
    });

    test('should create an IP of type IPv6 from database', () => {
        expect(
            IP.fromDatabase('2001:0db8:85a3:0000:0000:8a2e:0370:7334')?.isIPv6()
        ).toBeTruthy();
    });

    test('should create an IP of type IPv4 through the transformer', () => {
        expect(
            IP.getDatabaseTransformer().from('127.0.0.1').isIPv4()
        ).toBeTruthy();
    });

    test('should create an IP of type IPv6 through the transformer', () => {
        expect(
            IP.getDatabaseTransformer()
                .from('2001:0db8:85a3:0000:0000:8a2e:0370:7334')
                .isIPv6()
        ).toBeTruthy();
    });

    test('should return a string from the transformers to function', () => {
        expect(IP.getDatabaseTransformer().to('127.0.0.1')).toBe('127.0.0.1');
    });

    test('should return null from the transformers to function', () => {
        expect(IP.getDatabaseTransformer().to('')).toBe(null);
    });
});
