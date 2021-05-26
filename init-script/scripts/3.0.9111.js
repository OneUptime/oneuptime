const { find, update } = require('../util/db');

const monitorCollection = 'monitors';
const statusPageCollection = 'statuspages';

async function run() {
    let monitors = await find(monitorCollection, {
        deleted: true,
    });
    monitors = monitors.map(monitor => monitor._id);
    const statusPages = await find(statusPageCollection, {
        'monitors.monitor': { $in: monitors },
    });
    monitors = monitors.map(monitor => String(monitor));

    for (const statusPage of statusPages) {
        const updatedMonitors = [];

        for (const monitorData of statusPage.monitors) {
            if (!monitors.includes(String(monitorData.monitor))) {
                updatedMonitors.push(monitorData);
            }
        }
        await update(
            statusPageCollection,
            { _id: statusPage._id },
            { monitors: updatedMonitors }
        );
    }

    return `Script ran for ${statusPages.length} status pages.`;
}
module.exports = run;
