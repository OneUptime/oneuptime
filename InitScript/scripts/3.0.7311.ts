import { find, update } from '../util/db';

import uuid from 'uuid';

const statusPageCollection: string = 'statuspages';

async function run(): void {
    const statusPages: $TSFixMe = await find(statusPageCollection, {
        statusBubbleId: { $exists: false },
    });

    for (let i = 0; i < statusPages.length; i++) {
        const statusPage: $TSFixMe = statusPages[i];
        const statusBubbleId: $TSFixMe = uuid.v4();
        await update(
            statusPageCollection,
            { _id: statusPage._id },
            { statusBubbleId }
        );
    }

    return `Script ran for ${statusPages.length} status pages.`;
}

export default run;
