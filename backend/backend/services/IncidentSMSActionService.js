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

    update: async (incidentSMSActionId, update)=>{
        try {
            var incidentSMSAction = incidentSMSActionModel.findById(incidentSMSActionId);
            incidentSMSAction.acknowledged = !!update.acknowledged;
            incidentSMSAction.resolved = !!update.resolved;
            var incidentafter = await incidentSMSAction.save();
            return incidentafter;
        } catch (error) {
            ErrorService.log('incidentSMSActionService.update', error);
            throw error;  
        }
    }

};

const incidentSMSActionModel = require('../models/incidentSMSAction');
const ErrorService = require('./errorService');
