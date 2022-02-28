
import { find, update } from '../util/db';

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
