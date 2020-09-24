const { find, update, removeField, rename } = require('../util/db');

const monitorCategoryCollection = 'monitorcategories';
const resourceCategoryCollection = 'resourcecategories';
const monitorCollection = 'monitors';

async function run() {
    // rename collection
    await rename(monitorCategoryCollection, resourceCategoryCollection);

    // get all monitors that have a monitorCategoryId
    const monitors = await find(monitorCollection, {
        monitorCategoryId: { $type: 'string' },
    });
    monitors.forEach(async monitor => {
        const resourceCategoryId = monitor.monitorCategoryId;

        // set their resourceCategoryId as the monitorCategoryId
        await update(
            monitorCollection,
            { _id: monitor._id },
            { resourceCategoryId }
        );

        // remove the monitorCategoryId field
        await removeField(
            monitorCollection,
            { _id: monitor._id },
            { monitorCategoryId: '' }
        );
    });

    return `Script ran for ${monitors.length} monitors`;
}

module.exports = run;
