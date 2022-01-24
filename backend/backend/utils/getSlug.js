const slugify = require('slugify');
const generate = require('nanoid/generate');

module.exports = function getSlug(name) {
    name = String(name);
    if (!name || !name.trim()) return;

    let slug = slugify(name, { remove: /[&*+~.,\\/()|'"!:@]+/g });
    slug = `${slug}-${generate('1234567890', 8)}`;
    slug = slug.toLowerCase();

    return slug;
};
