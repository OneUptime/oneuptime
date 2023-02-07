import ErrorResponse from '../../../Types/API/HTTPErrorResponse';
describe('ErrorResponse', () => {
    test('should return a valid error response object', () => {
        const errorResponseObject: ErrorResponse = new ErrorResponse(
            500,
            {
                error: 'Internal Server Error',
            },
            {}
        );
        expect(errorResponseObject.statusCode).toBe(500);
        expect(errorResponseObject.data).toEqual({
            error: 'Internal Server Error',
        });
    });
});
