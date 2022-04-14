import { find, update } from '../util/db';

const statusPageCollection: string = 'statuspages';

async function run(): void {
    const statusPages: $TSFixMe = await find(statusPageCollection, {
        multipleNotificationTypes: { $exists: false },
    });

    for (let i: $TSFixMe = 0; i < statusPages.length; i++) {
        const statusPage: $TSFixMe = statusPages[i];
        await update(
            statusPageCollection,
            { _id: statusPage._id },
            { multipleNotificationTypes: false }
        );
    }
}

export default run;
