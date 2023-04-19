import { ObjectType } from '../../Types/JSON';

describe('ObjectType', () => {
    const expectedFields: Array<keyof typeof ObjectType> = [
        'ObjectID',
        'Name',
        'EqualToOrNull',
        'NotEqual',
        'Email',
        'Phone',
        'Color',
        'Domain',
        'Version',
        'Route',
        'URL',
        'Permission',
        'Search',
        'GreaterThan',
        'GreaterThanOrEqual',
        'LessThan',
        'LessThanOrEqual',
        'Port',
        'Hostname',
        'HashedString',
        'DateTime',
        'Buffer',
        'InBetween',
        'NotNull',
        'IsNull',
    ];

    test.each(expectedFields)(
        'ObjectType has %s',
        (field: keyof typeof ObjectType) => {
            expect(ObjectType[field]).toBe(field);
        }
    );
});
