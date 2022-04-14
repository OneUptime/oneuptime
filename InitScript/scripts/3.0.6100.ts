import { find, update } from '../util/db';

const  statusPageCollection: string = 'statuspages';

async function run(): void {
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
