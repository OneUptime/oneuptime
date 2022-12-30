import DatabaseType from '../../Types/DatabaseType';

describe('enum DatabaseType', () => {
    test('DatabaseType.Postgres should be Postgres', () => {
        expect(DatabaseType.Postgres).toEqual('postgres');
    });
});
