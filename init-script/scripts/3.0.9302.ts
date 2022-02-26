// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'upda... Remove this comment to see the full error message
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
