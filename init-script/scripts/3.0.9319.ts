
import { find, update } from '../util/db';

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
