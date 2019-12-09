
module.exports = {

    create: async function (projectId, createdById, name) {
        try {
            var monitorCategory = new MonitorCategoryModel();
            monitorCategory.projectId = projectId;
            monitorCategory.createdById = createdById;
            monitorCategory.name = name;
            monitorCategory = await monitorCategory.save();
            return monitorCategory;
        } catch (error) {
            ErrorService.log('monitorCategory.save', error);
            throw error;
        }
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
            
            return monitorCategory;
        } catch (error) {
            ErrorService.log('monitorCategory.delete', error);
            throw error;
        }
    },

    findBy: async function (query, limit, skip) {
        try {
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
            ErrorService.log('MonitorCategoryService.findBy', error);
            throw error;
        }
    },
    updateBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }
            var monitorCategory;
            monitorCategory = await MonitorCategoryModel.findOneAndUpdate(query, {
                $set: data
            },{
                new: true
            });
            return monitorCategory;
        } catch (error) {
            ErrorService.log('MonitorCategoryService.updateBy', error);
            throw error;
        }
    },
    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }
    
            query.deleted = false;
            var count = await MonitorCategoryModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('MonitorCategoryService.count', error);
            throw error;
        }
    },
    hardDeleteBy: async function (query) {
        try {
            await MonitorCategoryModel.deleteMany(query);
            return 'Monitor Categories(s) removed successfully!';
        } catch (error) {
            ErrorService.log('MonitorCategoryService.deleteMany', error);
            throw error;
        }
    },
};

var MonitorCategoryModel = require('../models/monitorCategory');
var MonitorModel = require('../models/monitor');
var ErrorService = require('../services/errorService');
