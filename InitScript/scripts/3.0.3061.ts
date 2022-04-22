import { find, update, removeField } from '../util/db';

const statusPageCollection: string = 'statuspages';

async function run(): void {
    const statusPages: $TSFixMe = await find(statusPageCollection, {
        monitorIds: { $exists: true },
    });
    for (let i: $TSFixMe = 0; i < statusPages.length; i++) {
        const statusPage: $TSFixMe = statusPages[i];
        const monitors: $TSFixMe = [];
        for (let j: $TSFixMe = 0; j < statusPage.monitorIds.length; j++) {
            monitors.push({
                monitor: statusPage.monitorIds[j],
                description: '',
                uptime: true,
                memory: false,
                cpu: false,
                storage: false,
                responseTime: false,
                temperature: false,
                runtime: false,
            });
        }
        const colors: $TSFixMe = {
            ...statusPage.colors,
            ...{
                strokeChart: { r: 0, g: 0, b: 0, a: 1 },
                fillChart: { r: 226, g: 225, b: 242, a: 1 },
            },
        };
        await update(
            statusPageCollection,
            { _id: statusPage._id },
            { monitors, colors }
        );
        await removeField(
            statusPageCollection,
            { _id: statusPage._id },
            'monitorIds'
        );
    }
}

export default run;
