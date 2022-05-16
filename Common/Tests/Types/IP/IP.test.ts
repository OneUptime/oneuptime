import IP from '../../../Types/IP/IP';

describe('IP()', () => {
    test('EXPECTS IP TO BE DEFINED', () => {
        const ip: IP = new IP('196.223.149.8');
        expect(ip.toString()).toBe('196.223.149.8');
    });

    test('Expects type of IP to be a string', () => {
        const ip: IP = new IP('196.223.149.8');
        expect(typeof ip.toString()).toBe('string');
    });

    test('Expects IP address to be mutable', () => {
        const ip: IP = new IP('196.223.149.8');
        const newIp: string = '127.0.0.1';
        ip.ip = newIp;
        expect(ip.ip).not.toBe('196.223.149.8');
    });

    test('Should throw an error twice', () => {
        const ip: IP = new IP('196.223.149.8');
        expect.assertions(2);
        expect(() => {
            ip.isIPv4();
        }).toThrow('This code is not implemented');
        expect(() => {
            ip.isIPv6();
        }).toThrow('This code is not implemented');
    });
});
