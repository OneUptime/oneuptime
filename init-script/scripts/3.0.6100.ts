// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'

const statusPageCollection = 'statuspages';

async function run() {
    const statusPages = await find(statusPageCollection, {
        ipWhitelist: { $exists: false },
    });

    statusPages.forEach(async (statusPage: $TSFixMe) => {
        const data = {
            ipWhitelist: [],
        };

        await update(statusPageCollection, { _id: statusPage._id }, data);
    });

    return `Script ran for ${statusPages.length} status pages`;
}

export default run;
