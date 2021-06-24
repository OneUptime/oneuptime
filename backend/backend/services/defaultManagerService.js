const DefaultManagerModel = require('../models/defaultManager');
const ErrorService = require('./errorService');

module.exports = {
    create: async function(data) {
        try {
            const defaultManager = await DefaultManagerModel.create(data);
            return defaultManager;
        } catch (error) {
            ErrorService.log('defaultManagerService.create', error);
            throw error;
        }
    },
    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const defaultManager = await DefaultManagerModel.findOne(query);
            return defaultManager;
        } catch (error) {
            ErrorService.log('defaultManagerService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = Number(skip);

            if (typeof limit === 'string') limit = Number(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const defaultManagers = await DefaultManagerModel.find(query)
                .lean()
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            return defaultManagers;
        } catch (error) {
            ErrorService.log('defaultManagerService.findBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        const _this = this;
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let defaultManager = await DefaultManagerModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

            await DefaultManagerModel.findOneAndUpdate(
                {
                    subscriberEmail: { $ne: data.subscriberEmail },
                },
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                    },
                }
            );

            if (!defaultManager) {
                defaultManager = await _this.create(data);
            }

            return defaultManager;
        } catch (error) {
            ErrorService.log('defaultManagerService.updateOneBy', error);
            throw error;
        }
    },
};
