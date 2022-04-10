import slugify from 'slugify';
import generate from 'nanoid';

export default function getSlug(name: $TSFixMe) {
    name = String(name);
    if (!name || !name.trim()) return;

    let slug = slugify(name, { remove: /[&*+~.,\\/()|'"!:@]+/g });

    slug = `${slug}-${generate('1234567890', 8)}`;
    slug = slug.toLowerCase();

    return slug;
}
