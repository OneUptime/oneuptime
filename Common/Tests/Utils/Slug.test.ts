import Slug from '../../Utils/Slug';
describe('Slug.getSlug()', () => {
    test('should  return empty string, if name is empty ', () => {
        expect(Slug.getSlug('')).toEqual('');
        expect(Slug.getSlug('     ')).toEqual('');
    });
    test('should replaces spaces in nonEmpty with hyphen -', () => {
        expect(Slug.getSlug('this is slug')).toMatch(/this-is-slug/g);
    });

    test('should append 10 numbers if non-empty string name is given', () => {
        expect(Slug.getSlug('slug')).toMatch(/^slug-+[\d]{10}$/);
    });
    test('should remove  character in [&*+~.,\\/()|\'"!:@]', () => {
        expect(Slug.getSlug(' *+~.,\\/()\'"!:@slug is awesome')).toMatch(
            /^slug-is-awesome-+[\d]{10}$/
        );
    });
});
