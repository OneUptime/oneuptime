import IP from '../Types/IP/IP';

describe('IP()', () => {
    let ip: IP;
    beforeAll(() => {
        ip = new IP('196.223.149.8');
    });

    test('EXPECTS IP TO BE DEFINED', () => {
        expect(ip.toString()).toBe('196.223.149.8');
    });

    test('Expects type of IP to be a string', () => {
        expect(typeof ip.ip).toBe('string');
    });

    test('Expects IP address to be mutable', () => {
        const newIp: string = '127.0.0.1';
        ip.ip = newIp;
        expect(ip.ip).not.toBe('196.223.149.8');
    });

    test('Should throw an error twice', () => {
        expect.assertions(2);
        expect(() => {
            ip.isIPv4();
        }).toThrow('This code is not implemented');
        expect(() => {
            ip.isIPv6();
        }).toThrow('This code is not implemented');
    });
});
