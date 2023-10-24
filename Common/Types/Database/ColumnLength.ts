import TableColumnType from './TableColumnType';

enum ColumnLength {
    Version = 30,
    Slug = 100,
    Email = 100,
    Domain = 100,
    Color = 7,
    Name = 50,
    Description = 500,
    LongText = 500,
    Password = 500,
    ShortURL = 100,
    ShortText = 100,
    HashedString = 64,
    Phone = 30,
    OTP = 8,
}

export const getMaxLengthFromTableColumnType: Function = (
    type: TableColumnType
): number | undefined => {
    if (type === TableColumnType.Version) {
        return ColumnLength.Version;
    }
    if (type === TableColumnType.Slug) {
        return ColumnLength.Slug;
    }
    if (type === TableColumnType.Email) {
        return ColumnLength.Email;
    }
    if (type === TableColumnType.Domain) {
        return ColumnLength.Domain;
    }
    if (type === TableColumnType.Color) {
        return ColumnLength.Color;
    }
    if (type === TableColumnType.Name) {
        return ColumnLength.Name;
    }
    if (type === TableColumnType.Description) {
        return ColumnLength.Description;
    }
    if (type === TableColumnType.LongText) {
        return ColumnLength.LongText;
    }
    if (type === TableColumnType.Password) {
        return ColumnLength.Password;
    }
    if (type === TableColumnType.ShortURL) {
        return ColumnLength.ShortURL;
    }
    if (type === TableColumnType.ShortText) {
        return ColumnLength.ShortText;
    }
    if (type === TableColumnType.HashedString) {
        return ColumnLength.HashedString;
    }
    if (type === TableColumnType.Phone) {
        return ColumnLength.Phone;
    }
    if (type === TableColumnType.OTP) {
        return ColumnLength.OTP;
    }

    return undefined;
};

export default ColumnLength;
