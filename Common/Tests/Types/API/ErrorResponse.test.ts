import HTTPErrorResponse from '../../../Types/API/HTTPErrorResponse';
describe('HTTPErrorResponse', () => {
    test('should return a valid error HTTPErrorResponse object', () => {
        const errorResponseObject: HTTPErrorResponse = new HTTPErrorResponse(500, {
            error: 'Internal Server Error',
        }, {});
        expect(errorResponseObject.statusCode).toBe(500);
        expect(errorResponseObject.data).toEqual({
            error: 'Internal Server Error',
        });
    });
});
