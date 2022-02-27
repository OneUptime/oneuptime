import slugify from 'slugify';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'nano... Remove this comment to see the full error message
import generate from 'nanoid/generate';

export default function getSlug(name: $TSFixMe) {
    name = String(name);
    if (!name || !name.trim()) return;

    let slug = slugify(name, { remove: /[&*+~.,\\/()|'"!:@]+/g });
    slug = `${slug}-${generate('1234567890', 8)}`;
    slug = slug.toLowerCase();

    return slug;
}
