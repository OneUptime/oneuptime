enum ColumnLength {
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
    ShortText = 'text',
    OTP = 'varchar',
    LongText = 'text',
    Date = 'timestamptz',
    Boolean = 'boolean',
    Array = 'simple-array',
}

export default ColumnLength;
