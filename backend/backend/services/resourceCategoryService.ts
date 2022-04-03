export default {
    create: async function (data: $TSFixMe) {
        const existingResourceCategory = await this.countBy({
            name: data.name,
            projectId: data.projectId,
        });
        if (existingResourceCategory && existingResourceCategory > 0) {
            const error = new Error(
                'A resource category with that name already exists.'
            );

            error.code = 400;
            throw error;
        }
        let resourceCategory = new ResourceCategoryModel();

        resourceCategory.projectId = data.projectId;

        resourceCategory.createdById = data.createdById;

        resourceCategory.name = data.name;
        resourceCategory = await resourceCategory.save();
        return resourceCategory;
    },

    deleteBy: async function (query: $TSFixMe, userId: $TSFixMe) {
        const resourceCategory = await ResourceCategoryModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            },
            { new: true }
        );

        await Promise.all([
            MonitorModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
            ApplicationLogModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
            ErrorTrackerModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
            ApplicationSecurityModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
            ContainerSecurityModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
        ]);

        return resourceCategory;
    },

    findBy: async function ({
        query,
        limit,
        skip,
        select,
        populate,
    }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        query.deleted = false;
        let resourceCategoriesQuery = ResourceCategoryModel.find(query)
            .lean()
            .limit(limit)
            .skip(skip)
            .sort({ createdAt: -1 });

        resourceCategoriesQuery = handleSelect(select, resourceCategoriesQuery);
        resourceCategoriesQuery = handlePopulate(
            populate,
            resourceCategoriesQuery
        );

        let resourceCategories = await resourceCategoriesQuery;

        resourceCategories = resourceCategories.map(
            (resourceCategory: $TSFixMe) => ({
                name: resourceCategory.name,
                _id: resourceCategory._id,
                createdAt: resourceCategory.createdAt,
            })
        );
        return resourceCategories;
    },

    updateOneBy: async function (query: $TSFixMe, data: $TSFixMe) {
        const existingResourceCategory = await this.countBy({
            name: data.name,
            projectId: data.projectId,
            _id: { $not: { $eq: data._id } },
        });
        if (existingResourceCategory && existingResourceCategory > 0) {
            const error = new Error(
                'A resource category with that name already exists.'
            );

            error.code = 400;
            throw error;
        }
        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;
        const resourceCategory = await ResourceCategoryModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        return resourceCategory;
    },

    updateBy: async function (query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedData = await ResourceCategoryModel.updateMany(query, {
            $set: data,
        });
        const select = 'projectId name createdById createdAt';
        updatedData = await this.findBy({ query, select });
        return updatedData;
    },

    countBy: async function (query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await ResourceCategoryModel.countDocuments(query);
        return count;
    },
    hardDeleteBy: async function (query: $TSFixMe) {
        await ResourceCategoryModel.deleteMany(query);
        return 'Resource Categories(s) removed successfully!';
    },
};

import ResourceCategoryModel from 'common-server/models/resourceCategory';
import MonitorModel from 'common-server/models/monitor';
import ApplicationLogModel from 'common-server/models/applicationLog';
import ErrorTrackerModel from 'common-server/models/errorTracker';
import ApplicationSecurityModel from 'common-server/models/applicationSecurity';
import ContainerSecurityModel from 'common-server/models/containerSecurity';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
