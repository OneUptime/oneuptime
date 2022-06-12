import Domain from '../../Types/Domain';
import BadDataException from '../../Types/Exception/BadDataException';

describe('class Domain', () => {
    test('new Domain() should return a valid object if domain is valid', () => {
        expect(new Domain('example.com')).toBeInstanceOf(Domain);
        expect(new Domain('example.com').toString()).toBe('example.com');
        expect(new Domain('example.com.ac')).toBeInstanceOf(Domain);
        expect(new Domain('example.com.ac').toString()).toBe('example.com.ac');
        expect(new Domain('example.com.ac').domain).toBe('example.com.ac');
        expect(new Domain('example.ac')).toBeInstanceOf(Domain);
        expect(new Domain('example.ac').toString()).toBe('example.ac');
        expect(new Domain('example.ac').domain).toBe('example.ac');
    });
    test('new Domain() should throw the BadDataException if domain is invalid', () => {
        expect(() => {
            return new Domain('example');
        }).toThrowError(BadDataException);
        expect(() => {
            new Domain('example');
        }).toThrowError(BadDataException);
        expect(() => {
            new Domain('example@com');
        }).toThrowError(BadDataException);

        expect(() => {
            new Domain('example.invalid');
        }).toThrowError(BadDataException);
        expect(() => {
            const validDomain: Domain = new Domain('example.valid');
            validDomain.domain = 'example.invalid';
        }).toThrowError(BadDataException);
    });
    test('Domain.domain should be mutable', () => {
        const domain: Domain = new Domain('example.com');
        domain.domain = 'example.io';
        expect(domain.domain).toEqual('example.io');
    });
});
