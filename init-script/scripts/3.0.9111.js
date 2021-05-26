const { find, update, updateMany } = require('../util/db');

const monitorCollection = 'monitors';
const statusPageCollection = 'statuspages';
const componentCollection = 'components';

async function run() {
    const components = await find(componentCollection, {
        deleted: true,
    });
    // delete monitors yet to be deleted
    for (const component of components) {
        await updateMany(
            monitorCollection,
            {
                deleted: false,
                componentId: component._id,
            },
            {
                deleted: true,
                deletedAt: component.deletedAt,
                deletedById: component.createdById, // was designed as string in the schema
            }
        );
    }
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
