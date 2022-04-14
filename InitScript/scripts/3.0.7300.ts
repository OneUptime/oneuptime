import { find, update } from '../util/db';

const monitorCollection: string = 'monitors';

async function run(): void {
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
