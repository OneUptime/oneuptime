import { find, update } from '../util/db';

const statusPageCollection: string = 'statuspages';

async function run(): void {
    const statusPages: $TSFixMe = await find(statusPageCollection, {
        hideResolvedIncident: { $exists: false },
    });

    for (let i = 0; i < statusPages.length; i++) {
        const statusPage: $TSFixMe = statusPages[i];
        await update(
            statusPageCollection,
            { _id: statusPage._id },
            { hideResolvedIncident: false }
        );
    }
}

export default run;
