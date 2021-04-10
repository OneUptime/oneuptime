const { find, update } = require('../util/db');
const slugify = require('slugify');
const generate = require('nanoid/generate');
const schedulesCollection = 'schedules';

async function run() {
    const schedules = await find(schedulesCollection, {
        slug: { $exists: false },
    });
    for (let i = 0; i < schedules.length; i++) {
        let { name } = schedules[i];
        name = slugify(name);
        name = `${name}-${generate('1234567890', 8)}`;
        schedules[i].slug = name.toLowerCase();
        await update(
            schedulesCollection,
            { _id: schedules[i]._id },
            { slug: schedules[i].slug }
        );
    }
    return `Script ran for ${schedules.length} schedules.`;
}
module.exports = run;
