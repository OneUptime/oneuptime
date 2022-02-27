// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, updateMany } from '../util/db';

const monitorCollection = 'monitors';

async function run() {
    const monitors = await find(monitorCollection, {
        deleted: false,
        regions: { $exists: false },
    });
    const monitorIds = monitors.map((monitor: $TSFixMe) => monitor._id);

    // add regions field to monitors
    // regions = []
    await updateMany(
        monitorCollection,
        { _id: { $in: monitorIds } },
        { regions: [] }
    );

    return `Script completed`;
}

export default run;
