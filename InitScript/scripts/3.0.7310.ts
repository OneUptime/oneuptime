import { find, update, removeField } from '../util/db';

const monitorCollection: string = 'monitors';

async function run(): void {
    const monitors = await find(monitorCollection, {
        thirdPartyVariable: { $exists: false },
        deleted: false,
    });

    for (const monitor of monitors) {
        const data: $TSFixMe = {
            thirdPartyVariable: [monitor.name],
        };

        await update(monitorCollection, { _id: monitor._id }, data);

        await removeField(monitorCollection, { _id: monitor._id }, 'variables');
    }

    return `Script ran for ${monitors.length} monitors`;
}

export default run;
