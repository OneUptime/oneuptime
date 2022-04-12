import { find, update, save, updateMany, findOne } from '../util/db';
import { ObjectId } from 'mongodb';
import moment from 'moment';

const monitorCollection = 'monitors';
const resourceCategoryCollection = 'resourcecategories';
const statusPageCategoryCollection = 'statuspagecategories';
const statusPageCollection = 'statuspages';

async function run(): void {
    // fetch status pages
    const statusPages = await find(statusPageCollection, {
        isGroupedByMonitorCategory: true,
        deleted: false,
    });

    for (const statusPage of statusPages) {
        // check if status page category is now being used for a particular status page
        // the assumption is that if no status page category is being used, then it's possible that resource category is still being used
        const statCategories = await find(statusPageCategoryCollection, {
            statusPageId: String(statusPage._id),
            deleted: false,
        });
        if (!statCategories || statCategories.length === 0) {
            const resourceCategories = await find(resourceCategoryCollection, {
                projectId: String(statusPage.projectId),
                deleted: false,
            });

            let updatedMonitors = statusPage.monitors;

            const monitorIds = statusPage.monitors.map((monitorObj: $TSFixMe) =>
                ObjectId(monitorObj.monitor)
            );
            for (const resourceCategory of resourceCategories) {
                // fetch monitors with this category
                const monitors = await find(monitorCollection, {
                    _id: { $in: monitorIds },
                    resourceCategory: String(resourceCategory._id),
                    deleted: false,
                });
                if (monitors && monitors.length > 0) {
                    await save(statusPageCategoryCollection, [
                        {
                            name: resourceCategory.name,
                            deleted: false,
                            statusPageId: String(statusPage._id),
                            createdAt: new Date(moment().format()),
                            updatedAt: new Date(moment().format()),
                        },
                    ]);

                    // update the status page with the category
                    const statusPageCategory = await findOne(
                        statusPageCategoryCollection,
                        {
                            name: resourceCategory.name,
                            statusPageId: String(statusPage._id),
                        }
                    );

                    let monitorIds = monitors.map((monitor: $TSFixMe) =>
                        ObjectId(monitor._id)
                    );
                    await updateMany(
                        monitorCollection,
                        { _id: { $in: monitorIds } },

                        { statusPageCategory: ObjectId(statusPageCategory._id) }
                    );

                    // stringify the ids
                    monitorIds = monitorIds.map((id: $TSFixMe) => String(id));
                    updatedMonitors = statusPage.monitors.map(
                        (monitorObj: $TSFixMe) => {
                            if (
                                monitorIds.includes(String(monitorObj.monitor))
                            ) {
                                monitorObj.statusPageCategory = ObjectId(
                                    statusPageCategory._id
                                );
                            }

                            return monitorObj;
                        }
                    );

                    // update the status page category
                    await update(
                        statusPageCollection,
                        { _id: statusPage._id },
                        { monitors: updatedMonitors }
                    );
                }
            }
        } else {
            // we need to fix the initial migration script
            const resourceCategories = await find(resourceCategoryCollection, {
                projectId: String(statusPage.projectId),
                deleted: false,
            });

            let updatedMonitors = statusPage.monitors;

            const monitorIds = statusPage.monitors.map((monitorObj: $TSFixMe) =>
                ObjectId(monitorObj.monitor)
            );
            for (const resourceCategory of resourceCategories) {
                // fetch monitors with this category
                const monitors = await find(monitorCollection, {
                    _id: { $in: monitorIds },
                    resourceCategory: String(resourceCategory._id),
                    deleted: false,
                });
                if (monitors && monitors.length > 0) {
                    // update the status page with the category
                    const statusPageCategory = await findOne(
                        statusPageCategoryCollection,
                        {
                            name: resourceCategory.name,
                            statusPageId: String(statusPage._id),
                        }
                    );

                    let monitorIds = monitors.map((monitor: $TSFixMe) =>
                        ObjectId(monitor._id)
                    );
                    await updateMany(
                        monitorCollection,
                        { _id: { $in: monitorIds } },

                        { statusPageCategory: ObjectId(statusPageCategory._id) }
                    );

                    // stringify the ids
                    monitorIds = monitorIds.map((id: $TSFixMe) => String(id));
                    updatedMonitors = statusPage.monitors.map(
                        (monitorObj: $TSFixMe) => {
                            if (
                                monitorIds.includes(String(monitorObj.monitor))
                            ) {
                                monitorObj.statusPageCategory = ObjectId(
                                    statusPageCategory._id
                                );
                            }

                            return monitorObj;
                        }
                    );

                    // update the status page category
                    await update(
                        statusPageCollection,
                        { _id: statusPage._id },
                        { monitors: updatedMonitors }
                    );
                }
            }
        }
    }

    return `Script completed`;
}

export default run;
