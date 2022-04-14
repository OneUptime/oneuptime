import { find, updateMany } from '../util/db';

const monitorCollection: string = 'monitors';

async function run(): void {
    const monitors: $TSFixMe = await find(monitorCollection, {
        deleted: false,
        regions: { $exists: false },
    });
    const monitorIds: $TSFixMe = monitors.map(
        (monitor: $TSFixMe) => monitor._id
    );

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
