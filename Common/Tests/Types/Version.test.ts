import BadDataException from '../../Types/Exception/BadDataException';
import Version from '../../Types/Version';

describe('class Version', () => {
    test('should create a version if version string is valid', () => {
        expect(new Version('1.2.1').toString()).toEqual('1.2.1');
        expect(new Version('1.2.1').version).toEqual('1.2.1');
    });
    test('Version.version should be mutatable', () => {
        const version: Version = new Version('1.2.1');
        version.version = '1.2.2';
        expect(version.version).toEqual('1.2.2');
        expect(version.toString()).toEqual('1.2.2');
    });
    test('mutating Version.version with invalid data should throw an BadDataExcepection', () => {
        const version: Version = new Version('1.0.0');
        expect(() => {
            version.version = '1';
        }).toThrowError(BadDataException);
        expect(() => {
            version.version = '1.1';
        }).toThrow('Version is not in valid format.');
        expect(() => {
            version.version = '1.1.0.0';
        }).toThrowError(BadDataException);
    });
    test('creating version new  Version with invalid data should throw an BadDataExcepection', () => {
        expect(() => {
            new Version('1');
        }).toThrowError(BadDataException);
        expect(() => {
            new Version('1.1');
        }).toThrow('Version is not in valid format.');
    });
});
