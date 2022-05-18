import DatabaseNotConnectedException from '../../../Types/Exception/DatabaseNotConnectedException';

describe('DatabaseNotConnectedException', () => {
    test('should return the error message set in database exception', () => {
        expect(new DatabaseNotConnectedException().message).toBe(
            'Database not connected'
        );
    });
});
