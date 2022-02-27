// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db';

const monitorCollection = 'monitors';

async function run() {
    // get all monitors that have a monitorCategoryId
    const monitors = await find(monitorCollection, {
        disabled: { $exists: false },
    });

    for (const monitor of monitors) {
        await update(
            monitorCollection,
            { _id: monitor._id },
            { disabled: false }
        );
    }

    return `Script ran for ${monitors.length} monitors`;
}

export default run;
