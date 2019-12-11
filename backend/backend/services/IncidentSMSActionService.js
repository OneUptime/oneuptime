module.exports = {
    get: async function (query) {
        try {
            var alerts = await incidentSMSActionModel.find(query).sort([['createdAt', -1]]);
            return alerts;
        } catch (error) {
            ErrorService.log('incidentSMSActionService.get', error);
            throw error;
        }
    },

    updateBy: async (query, data) => {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var incidentafter = await incidentSMSActionModel.findOneAndUpdate(query, {
                $set: data
            }, {
                new: true
            });
            return incidentafter;
        } catch (error) {
            ErrorService.log('incidentSMSActionService.updateBy', error);
            throw error;
        }
    }

};

const incidentSMSActionModel = require('../models/incidentSMSAction');
const ErrorService = require('./errorService');
