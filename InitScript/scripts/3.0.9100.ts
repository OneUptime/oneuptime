import { find, update } from '../util/db';

const scheduledCollection: string = 'scheduledevents';

async function run(): void {
    const events: $TSFixMe = await find(scheduledCollection, {
        recurring: { $exists: false },
        interval: { $exists: false },
    });

    for (let i: $TSFixMe = 0; i < events.length; i++) {
        const event: $TSFixMe = events[i];
        await update(
            scheduledCollection,
            { _id: event._id },
            { recurring: false, interval: null }
        );
    }
}

export default run;
