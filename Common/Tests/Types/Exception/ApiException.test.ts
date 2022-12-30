import APIException from '../../../Types/Exception/ApiException';

describe('ApiException', () => {
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
});
