import slugify from 'slugify';
import { customAlphabet } from 'nanoid';
import { numbers } from 'nanoid-dictionary';

export default class Slug {
    public static getSlug(name: string): string {
        name = String(name);
        if (!name || !name.trim()) {
            return '';
        }

        let slug: string = slugify(name, { remove: /[&*+~.,\\/()|'"!:@]+/g });
        slug = `${slug}-${customAlphabet(numbers, 10)()}`;
        slug = slug.toLowerCase();

        return slug;
    }
}
