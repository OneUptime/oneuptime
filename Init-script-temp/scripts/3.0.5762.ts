import { find, update, removeField, rename } from '../util/db';

const monitorCategoryCollection = 'monitorcategories';
const resourceCategoryCollection = 'resourcecategories';
const monitorCollection = 'monitors';

async function run() {
    // rename collection
    await rename(monitorCategoryCollection, resourceCategoryCollection);

    // get all monitors that have a monitorCategoryId
    const monitors = await find(monitorCollection, {
        monitorCategoryId: { $exists: true },
    });
    monitors.forEach(async (monitor: $TSFixMe) => {
        const resourceCategory = monitor.monitorCategoryId;

        // set their resourceCategory as the monitorCategoryId
        await update(
            monitorCollection,
            { _id: monitor._id },
            { resourceCategory }
        );

        // remove the monitorCategoryId field
        await removeField(
            monitorCollection,
            { _id: monitor._id },
            'monitorCategoryId'
        );
    });

    return `Script ran for ${monitors.length} monitors`;
}

export default run;
