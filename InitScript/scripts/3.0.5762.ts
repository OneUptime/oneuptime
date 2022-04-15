import { find, update, removeField, rename } from '../util/db';

const monitorCategoryCollection: string = 'monitorcategories';
const resourceCategoryCollection: string = 'resourcecategories';
const monitorCollection: string = 'monitors';

async function run(): void {
    // Rename collection
    await rename(monitorCategoryCollection, resourceCategoryCollection);

    // Get all monitors that have a monitorCategoryId
    const monitors: $TSFixMe = await find(monitorCollection, {
        monitorCategoryId: { $exists: true },
    });
    monitors.forEach(async (monitor: $TSFixMe) => {
        const resourceCategory: $TSFixMe = monitor.monitorCategoryId;

        // Set their resourceCategory as the monitorCategoryId
        await update(
            monitorCollection,
            { _id: monitor._id },
            { resourceCategory }
        );

        // Remove the monitorCategoryId field
        await removeField(
            monitorCollection,
            { _id: monitor._id },
            'monitorCategoryId'
        );
    });

    return `Script ran for ${monitors.length} monitors`;
}

export default run;
