import type Dictionary from '../../Types/Dictionary';
describe('Dictionary', () => {
    test('should allow basic types   compile', () => {
        const dictionary: Dictionary<string> = {
            property: 'string',
        };
        const numberDictionary: Dictionary<number> = {
            property: 1,
        };

        expect(dictionary['property']).toEqual('string');
        expect(numberDictionary['property']).toEqual(1);
    });
    test('should allow the complex type', () => {
        const nestedDictionary: Dictionary<{ nested: string }> = {
            property: { nested: 'stringValue' },
        };
        const nestedArrayDictionary: Dictionary<{ nested: Array<string> }> = {
            property: { nested: ['stringValue'] },
        };

        expect(nestedDictionary['property']?.nested).toEqual('stringValue');
        expect(nestedArrayDictionary['property']?.nested.length).toEqual(1);
    });
});
