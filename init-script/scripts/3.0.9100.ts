// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
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
