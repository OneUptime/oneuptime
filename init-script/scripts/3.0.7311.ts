// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import uuid from 'uuid';

const statusPageCollection = 'statuspages';

async function run() {
    const statusPages = await find(statusPageCollection, {
        statusBubbleId: { $exists: false },
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

export default run;
