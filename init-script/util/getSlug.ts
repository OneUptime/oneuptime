import slugify from 'slugify';
import generate from 'nanoid';

export default function getSlug(name: $TSFixMe) {
    name = String(name);
    if (!name || !name.trim()) return;

    let slug = slugify(name, { remove: /[&*+~.,\\/()|'"!:@]+/g });
    // @ts-expect-error ts-migrate(2349) FIXME: This expression is not callable.
    slug = `${slug}-${generate('1234567890', 8)}`;
    slug = slug.toLowerCase();

    return slug;
}
