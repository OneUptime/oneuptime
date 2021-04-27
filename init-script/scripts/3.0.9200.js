const { find, update } = require('../util/db');
const slugify = require('slugify');
const generate = require('nanoid/generate');
const statusPageCollection = 'statuspages';

async function run() {
    const statusPages = await find(statusPageCollection, {
        slug: { $exists: false },
    });
    for (let i = 0; i < statusPages.length; i++) {
        let { name } = statusPages[i];
        name = slugify(name || "statuspage");
        name = `${name}-${generate('1234567890', 8)}`;
        statusPages[i].slug = name.toLowerCase();
        await update(
            statusPageCollection,
            { _id: statusPages[i]._id },
            { slug: statusPages[i].slug }
        );
    }
    return `Script ran for ${statusPages.length} status pages.`;
}
module.exports = run;
