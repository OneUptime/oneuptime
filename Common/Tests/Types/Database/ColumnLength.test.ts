import { getMaxLengthFromTableColumnType } from '../../../Types/Database/ColumnLength';
import TableColumnType from '../../../Types/Database/TableColumnType';

describe('enum ColumnLength', () => {
    test.each([
        [TableColumnType.Version, 30],
        [TableColumnType.Slug, 100],
        [TableColumnType.Email, 100],
        [TableColumnType.Domain, 100],
        [TableColumnType.Color, 7],
        [TableColumnType.Name, 50],
        [TableColumnType.Description, 500],
        [TableColumnType.LongText, 500],
        [TableColumnType.Password, 500],
        [TableColumnType.ShortURL, 100],
        [TableColumnType.ShortText, 100],
        [TableColumnType.HashedString, 64],
        [TableColumnType.Phone, 30],
        [TableColumnType.OTP, 8],

        [TableColumnType.Date, undefined],
        ['Random', undefined],

    ])('length for column %s is %d ', (columnType, expected) => {
        expect(getMaxLengthFromTableColumnType(columnType)).toBe(expected);
    });
});
