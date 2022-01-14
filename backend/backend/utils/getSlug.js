const slugify = require('slugify');
const { nanoid } = require('nanoid');

module.exports = function getSlug(name) {
    name = String(name);
    if (!name || !name.trim()) return;

    let slug = slugify(name, { remove: /[&*+~.,\\/()|'"!:@]+/g });
    slug = `${slug}-${nanoid('1234567890', 8)}`;
    slug = slug.toLowerCase();

    return slug;
};
