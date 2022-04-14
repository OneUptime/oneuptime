import { updateMany } from '../util/db';

const scheduledCollection: string = 'scheduledevents';

async function run(): void {
    await updateMany(
        scheduledCollection,
        { cancelled: { $exists: false } },
        { cancelled: false }
    );

    return `Script completed`;
}

export default run;
