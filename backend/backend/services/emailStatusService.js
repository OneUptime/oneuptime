module.exports = {

    findBy: async function ({query, limit, skip, sort}) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof (skip) === 'string') skip = parseInt(skip);

            if (typeof (limit) === 'string') limit = parseInt(limit);

            if (!query) {
                query = {};
            }

            if(!sort){
                sort = { createdAt: 'desc' };
            }

            if (!query.deleted) query.deleted = false;
            var items = await EmailStatusModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort(sort);
            return items;
        } catch (error) {
            ErrorService.log('emailStatusService.findBy', error);
            throw error;
        }
    },

    create: async function ({from, to, status, subject, body, template}) {
        try {
            
            var item = new EmailStatusModel();

            item.status = status;
            item.from = from;
            item.to = to;
            item.subject = subject;
            item.body = body; 
            item.template = template;

            item = await item.save();
            
            return item;
           
        } catch (error) {
            ErrorService.log('emailStatusService.create', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var count = await EmailStatusModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('emailStatusService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function (query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var items = await EmailStatusModel.findOneAndUpdate(query, { $set: { deleted: true, deletedAt: Date.now(), deletedById: userId } });
            return items;
        } catch (error) {
            ErrorService.log('emailStatusService.findOneAndUpdate', error);
            throw error;
        }
    },

    // Description: Get EmailStatus by item Id.
    // Params:
    // Param 1: monitorId: monitor Id
    // Returns: promise with item or error.
    findOneBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var item = await EmailStatusModel.findOne(query);
            return item;
        } catch (error) {
            ErrorService.log('emailStatusService.findOne', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;

            var updatedEmailStatus = await EmailStatusModel.findOneAndUpdate(query, {
                $set: data
            }, { new: true });
        } catch (error) {
            ErrorService.log('emailStatusService.updateOneBy', error);
            throw error;
        }
        return updatedEmailStatus;
    },

    updateBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var updatedData = await EmailStatusModel.updateMany(query, {
                $set: data
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('emailStatusService.updateMany', error);
            throw error;
        }
    }
};

var EmailStatusModel = require('../models/emailStatus');
var ErrorService = require('./errorService');