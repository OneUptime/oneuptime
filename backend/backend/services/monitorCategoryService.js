
module.exports = {

    create: async function (projectId, createdById, name) {
        var monitorCategory = new MonitorCategoryModel();
        monitorCategory.projectId = projectId;
        monitorCategory.createdById = createdById;
        monitorCategory.name = name;

        try {
            monitorCategory = await monitorCategory.save();
        } catch (error) {
            ErrorService.log('monitorCategory.save', error);
            throw error;
        }
        return monitorCategory;
    },

    deleteBy: async function (query, userId) {

        try {
            var monitorCategory = await MonitorCategoryModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId
                }
            }, { new: true });
            
            await MonitorModel.updateMany({ monitorCategoryId: query._id }, {
                $set: {
                    monitorCategoryId: null
                }
            });
            
        } catch (error) {
            ErrorService.log('monitorCategory.delete', error);
            throw error;
        }
        return monitorCategory;
    },

    findBy: async function (query, limit, skip) {

        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof (skip) === 'string') {
            skip = parseInt(skip);
        }

        if (typeof (limit) === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        query.deleted = false;

        try {
            var monitorCategories = await MonitorCategoryModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 });
            monitorCategories = monitorCategories.map(monitorCategory => ({
                name: monitorCategory.name,
                _id: monitorCategory._id,
                createdAt: monitorCategory.createdAt
            }));
            return monitorCategories;
        }
        catch (error) {
            ErrorService.log('monitorCategory.findAll', error);
            throw error;
        }
    },
    updateBy: async function (query, data) {
        if (!query) {
            query = {};
        }
        var monitorCategory;
        try {
            monitorCategory = await MonitorCategoryModel.findOneAndUpdate(query, {
                $set: data
            },{
                new: true
            });
        } catch (error) {
            ErrorService.log('monitorCategory.Update', error);
            throw error;
        }
        return monitorCategory;
    },
    countBy: async function (query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var count = await MonitorCategoryModel.count(query);
        } catch (error) {
            ErrorService.log('monitorCategory.count', error);
            throw error;
        }

        return count;
    },
    hardDeleteBy: async function (query) {
        try {
            await MonitorCategoryModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('MonitorCategoryModel.deleteMany', error);
            throw error;
        }
        return 'Monitor Categories(s) removed successfully!';
    },
};

var MonitorCategoryModel = require('../models/monitorCategory');
var MonitorModel = require('../models/monitor');
var ErrorService = require('../services/errorService');