import { updateMany } from '../util/db'

const scheduledCollection = 'scheduledevents';

async function run() {
    await updateMany(
        scheduledCollection,
        { cancelled: { $exists: false } },
        { cancelled: false }
    );

    return `Script completed`;
}

export default run;
