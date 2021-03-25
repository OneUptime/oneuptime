const { find, update } = require('../util/db');

const statusPageCollection = 'statuspages';

async function run() {
    const statusPages = await find(statusPageCollection, {
        ipWhitelist: { $exists: false },
    });

    statusPages.forEach(async statusPage => {
        const data = {
            ipWhitelist: [],
        };

        await update(statusPageCollection, { _id: statusPage._id }, data);
    });

    return `Script ran for ${statusPages.length} status pages`;
}

module.exports = run;
