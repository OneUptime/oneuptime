// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db';

const monitorCollection = 'monitors';

async function run() {
    const monitors = await find(monitorCollection, {
        variables: { $exists: false },
    });

    monitors.forEach(async (monitor: $TSFixMe) => {
        const data = {
            variables: [monitor.name],
        };

        await update(monitorCollection, { _id: monitor._id }, data);
    });

    return `Script ran for ${monitors.length} status pages`;
}

export default run;
