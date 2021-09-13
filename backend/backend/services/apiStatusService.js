const ApiStatusModel = require('../models/apiStatus');
const ErrorService = require('./errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

module.exports = {
    create: async function(data) {
        try {
            const apiStatus = await ApiStatusModel.create(data);
            return apiStatus;
        } catch (error) {
            ErrorService.log('apStatusService.create', error);
            throw error;
        }
    },
    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let apiStatusQuery = ApiStatusModel.findOne(query).lean();

            apiStatusQuery = handleSelect(select, apiStatusQuery);
            apiStatusQuery = handlePopulate(populate, apiStatusQuery);

            const apiStatus = await apiStatusQuery;
            return apiStatus;
        } catch (error) {
            ErrorService.log('apStatusService.findOneBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        const _this = this;
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let apiStatus = await ApiStatusModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

            // create apiStatus details if does not already exist
            if (!apiStatus) {
                apiStatus = await _this.create(data);
            }

            return apiStatus;
        } catch (error) {
            ErrorService.log('apStatusService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            const apiStatus = await this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
                lastOperation: 'delete',
            });
            return apiStatus;
        } catch (error) {
            ErrorService.log('apStatusService.deleteBy', error);
            throw error;
        }
    },
};
