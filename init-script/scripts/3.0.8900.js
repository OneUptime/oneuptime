const { find, update } = require('../util/db');
const slugify = require('slugify');
const generate = require('nanoid/generate');
const componentCollection = 'components';

async function run() {
    const components = await find(componentCollection, {
        slug: { $exists: false },
    });
    for (let i = 0; i < components.length; i++) {
        let { name } = components[i];
        name = slugify(name);
        name = `${name}-${generate('1234567890', 8)}`;
        components[i].slug = name.toLowerCase();
        await update(
            componentCollection,
            { _id: components[i]._id },
            { slug: components[i].slug }
        );
    }
    return `Script ran for ${components.length} components.`;
}
module.exports = run;
