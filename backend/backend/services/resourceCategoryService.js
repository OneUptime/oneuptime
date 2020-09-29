module.exports = {
    create: async function(data) {
        try {
            const existingResourceCategory = await this.findBy({
                name: data.name,
                projectId: data.projectId,
            });
            if (
                existingResourceCategory &&
                existingResourceCategory.length > 0
            ) {
                const error = new Error(
                    'A resource category with that name already exists.'
                );
                error.code = 400;
                ErrorService.log('resourceCategoryService.create', error);
                throw error;
            }
            let resourceCategory = new ResourceCategoryModel();
            resourceCategory.projectId = data.projectId;
            resourceCategory.createdById = data.createdById;
            resourceCategory.name = data.name;
            resourceCategory = await resourceCategory.save();
            return resourceCategory;
        } catch (error) {
            ErrorService.log('resourceCategoryService.create', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
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

            await MonitorModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            );

            await ApplicationLogModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            );

            await ApplicationSecurityModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            );

            await ContainerSecurityModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            );

            return resourceCategory;
        } catch (error) {
            ErrorService.log('resourceCategoryService.deleteBy', error);
            throw error;
        }
    },

    findBy: async function(query, limit, skip) {
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

            query.deleted = false;
            let resourceCategories = await ResourceCategoryModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 });
            resourceCategories = resourceCategories.map(resourceCategory => ({
                name: resourceCategory.name,
                _id: resourceCategory._id,
                createdAt: resourceCategory.createdAt,
            }));
            return resourceCategories;
        } catch (error) {
            ErrorService.log('resourceCategoryService.findBy', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            const existingResourceCategory = await this.findBy({
                name: data.name,
                projectId: data.projectId,
                _id: { $not: { $eq: data._id } },
            });
            if (
                existingResourceCategory &&
                existingResourceCategory.length > 0
            ) {
                const error = new Error(
                    'A resource category with that name already exists.'
                );
                error.code = 400;
                ErrorService.log('resourceCategoryService.updateOneBy', error);
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
        } catch (error) {
            ErrorService.log('resourceCategoryService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await ResourceCategoryModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('resourceCategoryService.updateMany', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const count = await ResourceCategoryModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('resourceCategoryService.countBy', error);
            throw error;
        }
    },
    hardDeleteBy: async function(query) {
        try {
            await ResourceCategoryModel.deleteMany(query);
            return 'Resource Categories(s) removed successfully!';
        } catch (error) {
            ErrorService.log('resourceCategoryService.hardDeleteBy', error);
            throw error;
        }
    },
};

const ResourceCategoryModel = require('../models/resourceCategory');
const MonitorModel = require('../models/monitor');
const ErrorService = require('./errorService');
const ApplicationLogModel = require('../models/applicationLog');
const ApplicationSecurityModel = require('../models/applicationSecurity');
const ContainerSecurityModel = require('../models/containerSecurity');
