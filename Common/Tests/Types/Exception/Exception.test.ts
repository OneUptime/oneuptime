import Exception from '../../../Types/Exception/Exception';

describe('Exception', () => {
    test('should throw an exception from exception class', () => {
        expect(() => {
            throw new Exception(1, 'General exception error message');
        }).toThrow('General exception error message');
    });

    test('should return error message', () => {
        expect(
            new Exception(0, 'This code has not been implemented').message
        ).toBe('This code has not been implemented');
    });

    test('should return 1 as the code for Exception', () => {
        expect(new Exception(1, 'This is not a valid IPv4 address').code).toBe(
            1
        );
    });
});
