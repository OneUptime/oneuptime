import Slug from '../Utils/Slug';
describe('Slug.getSlug()', () => {
    let slug: string;
    test('should  return empty string, if name is empty ', () => {
        slug = Slug.getSlug('');
        expect(slug).toEqual('');
        slug = Slug.getSlug('     ');
        expect(slug).toEqual('');
    });
    test('should replaces spaces in nonEmpty with hyphen -', () => {
        slug = Slug.getSlug('this is slug');
        expect(slug).toMatch(/this-is-slug/g);
    });

    test('should append 10 numbers if non-empty string name is given', () => {
        slug = Slug.getSlug('slug');
        expect(slug).toMatch(/^slug-+[\d]{10}$/);
    });
    test('should remove  character in [&*+~.,\\/()|\'"!:@]', () => {
        slug = Slug.getSlug(' *+~.,\\/()\'"!:@slug is awesome');
        expect(slug).toMatch(/^slug-is-awesome-+[\d]{10}$/);
    });
});
