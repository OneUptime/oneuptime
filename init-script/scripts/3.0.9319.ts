// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'

const monitorCollection = 'monitors';

async function run() {
    const monitors = await find(monitorCollection, {
        deleted: false,
    });

    for (const monitor of monitors) {
        // reset probeScanning field to empty array
        await update(
            monitorCollection,
            { _id: monitor._id },
            { probeScanning: [] }
        );
    }

    return `Script ran for ${monitors.length} monitors`;
}

export default run;
