import Exception from '../../../Types/Exception/Exception';

describe('Exception', () => {
    test('should throw an exception from exception class', () => {
        expect(() => {
            throw new Exception(1, 'General exception error message');
        }).toThrow('General exception error message');
    });

    test('should not accept invalid error code', () => {
        expect(() => {
            new Exception(700, 'error message');
        }).toThrow('Invalid error code');
    });

    test('should return error message', () => {
        expect(
            new Exception(0, 'This code has not been implemented').message
        ).toBe('This code has not been implemented');
    });
});
