const { find, update } = require('../util/db');

const scheduledCollection = 'scheduledevents';

async function run() {
    const items = await find(scheduledCollection, {
        slug: { $exists: false },
    });
    for (let i = 0; i < items.length; i++) {
        let { name } = items[i];
        name = slugify(name || 'scheduledevents');
        name = `${name}-${generate('1234567890', 8)}`;
        items[i].slug = name.toLowerCase();
        await update(
            scheduledCollection,
            { _id: items[i]._id },
            { slug: items[i].slug }
        );
    }
    return `Script ran for ${items.length} status pages.`;
}

module.exports = run;
