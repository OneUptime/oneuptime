const { find, update } = require('../util/db');
const slugify = require('slugify');
const generate = require('nanoid/generate');
const monitorCollection = 'monitors';

async function run() {
    const monitors = await find(monitorCollection, {
        slug: { $exists: false }
    });
    for (let i = 0; i < monitors.length; i++) {
        let { name } = monitors[i];
        name = slugify(name);
        name = `${name}-${generate('1234567890', 8)}`;
        monitors[i].slug = name.toLowerCase();
        await update(
            monitorCollection,
            { _id: monitors[i]._id },
            { slug: monitors[i].slug }
        );
    }
    return `Script ran for ${monitors.length} monitors.`;
}
module.exports = run;
