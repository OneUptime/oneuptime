// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update, removeField } from '../util/db'

const monitorCollection = 'monitors';

async function run() {
    const monitors = await find(monitorCollection, {
        thirdPartyVariable: { $exists: false },
        deleted: false,
    });

    for (const monitor of monitors) {
        const data = {
            thirdPartyVariable: [monitor.name],
        };

        await update(monitorCollection, { _id: monitor._id }, data);

        await removeField(monitorCollection, { _id: monitor._id }, 'variables');
    }

    return `Script ran for ${monitors.length} monitors`;
}

export default run;
