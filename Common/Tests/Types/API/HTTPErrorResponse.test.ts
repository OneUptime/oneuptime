import HTTPErrorResponse from '../../../Types/API/HTTPErrorResponse';

describe('HTTPErrorResponse', () => {
    it('should return an empty string when data is null', () => {
        const httpResponse: HTTPErrorResponse = new HTTPErrorResponse(
            404,
            { data: null },
            {}
        );
        expect(httpResponse.message).toBe('');
    });

    it('should return the message from the "data" property if present', () => {
        const httpResponse: HTTPErrorResponse = new HTTPErrorResponse(
            200,
            { data: 'Data message' },
            {}
        );
        expect(httpResponse.message).toBe('Data message');
    });

    it('should return the message from the "message" property if present', () => {
        const httpResponse: HTTPErrorResponse = new HTTPErrorResponse(
            200,
            { message: 'Message message' },
            {}
        );
        expect(httpResponse.message).toBe('Message message');
    });

    it('should return the message from the "error" property if no other message properties are present', () => {
        const httpResponse: HTTPErrorResponse = new HTTPErrorResponse(
            500,
            { error: 'Error message' },
            {}
        );
        expect(httpResponse.message).toBe('Error message');
    });

    it('should return an empty string when no relevant message properties are present', () => {
        const httpResponse: HTTPErrorResponse = new HTTPErrorResponse(
            204,
            { otherProperty: 'Other message' },
            {}
        );
        expect(httpResponse.message).toBe('');
    });

    it('should prioritize "data" > "message" > "error" when multiple message properties are present', () => {
        const httpResponse: HTTPErrorResponse = new HTTPErrorResponse(
            201,
            {
                data: 'Data message',
                message: 'Message message',
                error: 'Error message',
            },
            {}
        );
        expect(httpResponse.message).toBe('Data message');
    });
});
