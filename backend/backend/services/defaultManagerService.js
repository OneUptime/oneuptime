const DefaultManagerModel = require('../models/defaultManager');
const ErrorService = require('./errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

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
    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let defaultManagerQuery = DefaultManagerModel.findOne(query);

            defaultManagerQuery = handleSelect(select, defaultManagerQuery);
            defaultManagerQuery = handlePopulate(populate, defaultManagerQuery);

            const defaultManager = await defaultManagerQuery;
            return defaultManager;
        } catch (error) {
            ErrorService.log('defaultManagerService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function({ query, limit, skip, select, populate }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = Number(skip);

            if (typeof limit === 'string') limit = Number(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let defaultManagerQuery = DefaultManagerModel.find(query)
                .lean()
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            defaultManagerQuery = handleSelect(select, defaultManagerQuery);
            defaultManagerQuery = handlePopulate(populate, defaultManagerQuery);

            const defaultManagers = await defaultManagerQuery;
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
