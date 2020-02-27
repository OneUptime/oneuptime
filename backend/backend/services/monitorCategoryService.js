module.exports = {
    create: async function(data) {
        try {
            const existingMonitorCategory = await this.findBy({
                name: data.name,
                projectId: data.projectId,
            });
            if (existingMonitorCategory && existingMonitorCategory.length > 0) {
                const error = new Error(
                    'A monitor category with that name already exists.'
                );
                error.code = 400;
                ErrorService.log('monitorCategoryService.create', error);
                throw error;
            }
            let monitorCategory = new MonitorCategoryModel();
            monitorCategory.projectId = data.projectId;
            monitorCategory.createdById = data.createdById;
            monitorCategory.name = data.name;
            monitorCategory = await monitorCategory.save();
            return monitorCategory;
        } catch (error) {
            ErrorService.log('monitorCategoryService.create', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            const monitorCategory = await MonitorCategoryModel.findOneAndUpdate(
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
                { monitorCategoryId: query._id },
                {
                    $set: {
                        monitorCategoryId: null,
                    },
                }
            );

            return monitorCategory;
        } catch (error) {
            ErrorService.log('monitorCategoryService.deleteBy', error);
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
            let monitorCategories = await MonitorCategoryModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 });
            monitorCategories = monitorCategories.map(monitorCategory => ({
                name: monitorCategory.name,
                _id: monitorCategory._id,
                createdAt: monitorCategory.createdAt,
            }));
            return monitorCategories;
        } catch (error) {
            ErrorService.log('monitorCategoryService.findBy', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            const existingMonitorCategory = await this.findBy({
                name: data.name,
                projectId: data.projectId,
                _id: { $not: { $eq: data._id } },
            });
            if (existingMonitorCategory && existingMonitorCategory.length > 0) {
                const error = new Error(
                    'A monitor category with that name already exists.'
                );
                error.code = 400;
                ErrorService.log('monitorCategoryService.updateOneBy', error);
                throw error;
            }
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;
            const monitorCategory = await MonitorCategoryModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
            return monitorCategory;
        } catch (error) {
            ErrorService.log('monitorCategoryService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await MonitorCategoryModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('monitorCategoryService.updateMany', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const count = await MonitorCategoryModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('monitorCategoryService.countBy', error);
            throw error;
        }
    },
    hardDeleteBy: async function(query) {
        try {
            await MonitorCategoryModel.deleteMany(query);
            return 'Monitor Categories(s) removed successfully!';
        } catch (error) {
            ErrorService.log('monitorCategoryService.hardDeleteBy', error);
            throw error;
        }
    },
};

const MonitorCategoryModel = require('../models/monitorCategory');
const MonitorModel = require('../models/monitor');
const ErrorService = require('../services/errorService');
