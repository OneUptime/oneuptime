enum ColumnType {
    Version = 'varchar',
    Phone = 'varchar',
    Password = 'varchar',
    Email = 'varchar',
    Slug = 'varchar',
    Name = 'varchar',
    Description = 'varchar',
    ObjectID = 'varchar',
    ShortURL = 'varchar',
    LongURL = 'text',
    ShortText = 'varchar',
    OTP = 'varchar',
    LongText = 'text',
    Date = 'timestamptz',
    Boolean = 'boolean',
    Array = 'simple-array',
    SmallPositiveNumber = 'smallint',
    PositiveNumber = 'integer',
    BigPositiveNumber = 'bigint',
    SmallNumber = 'smallint',
    Number = 'integer',
    BigNumber = 'bigint'
}

export default ColumnType;
