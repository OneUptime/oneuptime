const { find, update } = require('../util/db');
const getSlug = require('../util/getSlug');
const statusPageCollection = 'statuspages';

async function run() {
    const statusPages = await find(statusPageCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
        ],
    });
    for (let i = 0; i < statusPages.length; i++) {
        const { name } = statusPages[i];
        statusPages[i].slug = getSlug(name);
        await update(
            statusPageCollection,
            { _id: statusPages[i]._id },
            { slug: statusPages[i].slug }
        );
    }
    return `Script ran for ${statusPages.length} status pages.`;
}
module.exports = run;
