import Text from '../../Types/Text';

describe('class Text', () => {
    test('Text.uppercaseFirstLetter should make string first letter Uppercase', () => {
        expect(Text.uppercaseFirstLetter('text')).toEqual('Text');
        expect(Text.uppercaseFirstLetter('another test')).toEqual(
            'Another test'
        );
    });
});
