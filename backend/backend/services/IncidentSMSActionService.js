module.exports = {
    get: async function (query) {
        try{
            var alerts = await incidentSMSActionModel.find(query).sort([['createdAt', -1]]);
        }catch(error){
            ErrorService.log('incidentSMSActionModel.find', error);
            throw error;
        }
        return alerts;
    },

    update: async (incidentSMSActionId, update)=>{
        try {
            var incidentSMSAction = incidentSMSActionModel.findById(incidentSMSActionId);
            incidentSMSAction.acknowledged = !!update.acknowledged;
            incidentSMSAction.resolved = !!update.resolved;
            var incidentafter = await incidentSMSAction.save();
        } catch (error) {
            ErrorService.log('incidentSMSAction.update', error);
            throw error;  
        }
        return incidentafter;
    }

};

const incidentSMSActionModel = require('../models/incidentSMSAction');
const ErrorService = require('./errorService');
