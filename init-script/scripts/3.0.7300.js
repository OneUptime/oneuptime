import { find, update } from '../util/db'

const monitorCollection = 'monitors';

async function run() {
    const monitors = await find(monitorCollection, {
        variables: { $exists: false },
    });

    monitors.forEach(async monitor => {
        const data = {
            variables: [monitor.name],
        };

        await update(monitorCollection, { _id: monitor._id }, data);
    });

    return `Script ran for ${monitors.length} status pages`;
}

export default run;
