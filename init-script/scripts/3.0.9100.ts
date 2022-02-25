import { find, update } from '../util/db'

const scheduledCollection = 'scheduledevents';

async function run() {
    const events = await find(scheduledCollection, {
        recurring: { $exists: false },
        interval: { $exists: false },
    });

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        await update(
            scheduledCollection,
            { _id: event._id },
            { recurring: false, interval: null }
        );
    }
}

export default run;
