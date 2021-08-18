const SiteManagerModel = require('../models/siteManager');
const ErrorService = require('./errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

module.exports = {
    create: async function(data) {
        try {
            const siteManager = await SiteManagerModel.create(data);
            return siteManager;
        } catch (error) {
            ErrorService.log('siteManagerService.create', error);
            throw error;
        }
    },
    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let siteManagerQuery = SiteManagerModel.findOne(query).lean();

            siteManagerQuery = handleSelect(select, siteManagerQuery);
            siteManagerQuery = handlePopulate(populate, siteManagerQuery);

            const siteManager = await siteManagerQuery;
            return siteManager;
        } catch (error) {
            ErrorService.log('siteManagerService.findOneBy', error);
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

            let siteManagerQuery = SiteManagerModel.find(query)
                .lean()
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            siteManagerQuery = handleSelect(select, siteManagerQuery);
            siteManagerQuery = handlePopulate(populate, siteManagerQuery);

            const siteManagers = await siteManagerQuery;
            return siteManagers;
        } catch (error) {
            ErrorService.log('siteManagerService.findBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        const _this = this;
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let siteManager = await SiteManagerModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

            if (!siteManager) {
                siteManager = await _this.create(data);
            }

            return siteManager;
        } catch (error) {
            ErrorService.log('siteManagerService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            const siteManager = await this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
            });
            return siteManager;
        } catch (error) {
            ErrorService.log('siteManagerService.deleteBy', error);
            throw error;
        }
    },
    hardDelete: async function(query) {
        try {
            await SiteManagerModel.deleteMany(query);
            return 'siteManager store successfully deleted';
        } catch (error) {
            ErrorService.log('siteManagerService.hardDelete', error);
            throw error;
        }
    },
};
