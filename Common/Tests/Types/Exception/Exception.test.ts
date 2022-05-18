import APIException from '../../../Types/Exception/ApiException';
import BadOperationException from '../../../Types/Exception/BadOperationException';
import BadRequestException from '../../../Types/Exception/BadRequestException';
import DatabaseNotConnectedException from '../../../Types/Exception/DatabaseNotConnectedException';
import Exception from '../../../Types/Exception/Exception';
import NotImplementedException from '../../../Types/Exception/NotImplementedException';

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

    test('should return error message from ApiException', () => {
        expect(
            new APIException('Server responded with a status code of 5000')
                .message
        ).toBe('Server responded with a status code of 5000');
    });

    test('should return 2 as the code for ApiException', () => {
        expect(
            new APIException('Server responded with a status code of 5000').code
        ).toBe(2);
    });

    test('should return error message from BadOperationException', () => {
        expect(
            new BadOperationException('Cannot await a non-thenable code')
                .message
        ).toBe('Cannot await a non-thenable code');
    });

    test('should throw a bad request exception', () => {
        expect(() => {
            throw new BadRequestException('Forbidden. A token is needed');
        }).toThrow('Forbidden. A token is needed');
    });

    test('should throw a not implemented exception', () => {
        expect(() => {
            throw new NotImplementedException();
        }).toThrow('This code is not implemented');
    });

    test('should return the error message set in database exception', () => {
        expect(new DatabaseNotConnectedException().message).toBe(
            'Database not connected'
        );
    });
});
