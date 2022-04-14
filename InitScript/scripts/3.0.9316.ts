import { find, update } from '../util/db';

const  statusPageCollection: string = 'statuspages';

async function run(): void {
    const statusPages = await find(statusPageCollection, {
        multipleNotificationTypes: { $exists: false },
    });

    for (let i = 0; i < statusPages.length; i++) {
        const statusPage = statusPages[i];
        await update(
            statusPageCollection,
            { _id: statusPage._id },
            { multipleNotificationTypes: false }
        );
    }
}

export default run;
