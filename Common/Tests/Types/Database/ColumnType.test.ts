import ColumnType from '../../../Types/Database/ColumnType';

describe('enum ColumnType', () => {
    test('ColumnType.Color should be varchar', () => {
        expect(ColumnType.Color).toEqual('varchar');
    });

    test('ColumnType.Version', () => {
        expect(ColumnType.Version).toEqual('varchar');
    });

    test('ColumnType.Phone', () => {
        expect(ColumnType.Phone).toEqual('varchar');
    });

    test('ColumnType.HashedString', () => {
        expect(ColumnType.HashedString).toEqual('varchar');
    });

    test('ColumnType.Password', () => {
        expect(ColumnType.Password).toEqual('varchar');
    });

    test('ColumnType.Email', () => {
        expect(ColumnType.Email).toEqual('varchar');
    });

    test('ColumnType.Slug', () => {
        expect(ColumnType.Slug).toEqual('varchar');
    });

    test('ColumnType.Name', () => {
        expect(ColumnType.Name).toEqual('varchar');
    });

    test('ColumnType.Description', () => {
        expect(ColumnType.Description).toEqual('varchar');
    });

    test('ColumnType.ObjectID', () => {
        expect(ColumnType.ObjectID).toEqual('varchar');
    });

    test('ColumnType.ShortURL', () => {
        expect(ColumnType.ShortURL).toEqual('varchar');
    });

    test('ColumnType.LongURL', () => {
        expect(ColumnType.LongURL).toEqual('text');
    });

    test('ColumnType.ShortText', () => {
        expect(ColumnType.ShortText).toEqual('varchar');
    });

    test('ColumnType.OTP', () => {
        expect(ColumnType.OTP).toEqual('varchar');
    });

    test('ColumnType.LongText', () => {
        expect(ColumnType.LongText).toEqual('varchar');
    });

    test('ColumnType.VeryLongText', () => {
        expect(ColumnType.VeryLongText).toEqual('text');
    });

    test('ColumnType.Date', () => {
        expect(ColumnType.Date).toEqual('timestamptz');
    });

    test('ColumnType.Boolean', () => {
        expect(ColumnType.Boolean).toEqual('boolean');
    });

    test('ColumnType.Array', () => {
        expect(ColumnType.Array).toEqual('simple-array');
    });

    test('ColumnType.SmallPositiveNumber', () => {
        expect(ColumnType.SmallPositiveNumber).toEqual('smallint');
    });

    test('ColumnType.PositiveNumber', () => {
        expect(ColumnType.PositiveNumber).toEqual('integer');
    });

    test('ColumnType.BigPositiveNumber', () => {
        expect(ColumnType.BigPositiveNumber).toEqual('bigint');
    });

    test('ColumnType.SmallNumber', () => {
        expect(ColumnType.SmallNumber).toEqual('smallint');
    });

    test('ColumnType.Number', () => {
        expect(ColumnType.Number).toEqual('integer');
    });

    test('ColumnType.BigNumber', () => {
        expect(ColumnType.BigNumber).toEqual('bigint');
    });
});
