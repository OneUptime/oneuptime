const { find, update } = require('../util/db');
const uuid = require('uuid');

const statusPageCollection = 'statuspages';

async function run() {
    const statusPages = await find(statusPageCollection, {
        statusBubbleId: { $exists: false },
        deleted: false,
    });

    for (let i = 0; i < statusPages.length; i++) {
        const statusPage = statusPages[i];
        const statusBubbleId = uuid.v4();
        await update(
            statusPageCollection,
            { _id: statusPage._id },
            { statusBubbleId }
        );
    }

    return `Script ran for ${statusPages.length} status pages.`;
}

module.exports = run;
