// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'

const escalationsCollection = 'escalations';

async function run() {
    const escalations = await find(escalationsCollection, {
        pushReminders: { $exists: false },
    });

    for (let i = 0; i < escalations.length; i++) {
        const escalation = escalations[i];
        await update(
            escalationsCollection,
            { _id: escalation._id },
            { pushReminders: 3, push: false }
        );
    }
}

export default run;
