import BadOperationException from '../../../Types/Exception/BadOperationException';

describe('BadOperationException', () => {
    test('should return error message from BadOperationException', () => {
        expect(
            new BadOperationException('Cannot await a non-thenable code')
                .message
        ).toBe('Cannot await a non-thenable code');
    });
});
