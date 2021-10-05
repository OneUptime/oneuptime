const StatusPageCategoryModel = require('../models/statusPageCategory');
const MonitorModel = require('../models/monitor');
const ErrorService = require('./errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

module.exports = {
    create: async function(data) {
        try {
            const existingStatusPageCategory = await this.countBy({
                name: data.name,
                statusPageId: data.statusPageId,
            });
            if (existingStatusPageCategory && existingStatusPageCategory > 0) {
                const error = new Error(
                    'A status page category with that name already exist.'
                );
                error.code = 400;
                ErrorService.log('statusPageCategoryService.create', error);
                throw error;
            }

            const statusPageCategory = await StatusPageCategoryModel.create(
                data
            );
            return statusPageCategory;
        } catch (error) {
            ErrorService.log('statusPageCategoryService.create', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            const statusPageCategory = await StatusPageCategoryModel.findOneAndUpdate(
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

            await MonitorModel.updateMany(
                { statusPageResourceCategory: query._id },
                {
                    $set: {
                        statusPageResourceCategory: null,
                    },
                }
            );

            return statusPageCategory;
        } catch (error) {
            ErrorService.log('statusPageCategoryService.deleteBy', error);
            throw error;
        }
    },

    findBy: async function({ query, limit, skip, select, populate }) {
        try {
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
            if (!query.deleted) {
                query.deleted = false;
            }

            let statusPageCategoriesQuery = StatusPageCategoryModel.find(query)
                .lean()
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 });

            statusPageCategoriesQuery = handleSelect(
                select,
                statusPageCategoriesQuery
            );
            statusPageCategoriesQuery = handlePopulate(
                populate,
                statusPageCategoriesQuery
            );

            const statusCategories = await statusPageCategoriesQuery;
            return statusCategories;
        } catch (error) {
            ErrorService.log('statusPageCategoryService.findBy', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            const existingStatusPageCategory = await this.countBy({
                name: data.name,
                _id: { $not: { $eq: query._id } },
            });
            if (existingStatusPageCategory && existingStatusPageCategory > 0) {
                const error = new Error(
                    'A status page category with that name already exists.'
                );
                error.code = 400;
                ErrorService.log(
                    'statusPageCategoryService.updateOneBy',
                    error
                );
                throw error;
            }
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;
            const statusPageCategory = await StatusPageCategoryModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
            return statusPageCategory;
        } catch (error) {
            ErrorService.log('statusPageCategoryService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await StatusPageCategoryModel.updateMany(query, {
                $set: data,
            });
            const select = 'projectId name createdById createdAt';
            updatedData = await this.findBy({ query, select });
            return updatedData;
        } catch (error) {
            ErrorService.log('statusPageCategoryService.updateMany', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) {
                query.deleted = false;
            }

            const count = await StatusPageCategoryModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('statusPageCategoryService.countBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await StatusPageCategoryModel.deleteMany(query);
            return 'Status Page Categories(s) removed successfully!';
        } catch (error) {
            ErrorService.log('statusPageCategoryService.hardDeleteBy', error);
            throw error;
        }
    },
};
