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

    updateBy: async (query,data)=>{
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
            var incidentafter = await incidentSMSActionModel.findOneAndUpdate(query, {
                $set: data
            }, {
                new: true
            });
        } catch (error) {
            ErrorService.log('incidentSMSActionModel.findOneAndUpdate', error);
            throw error;
        }
        return incidentafter;
    }

};

const incidentSMSActionModel = require('../models/incidentSMSAction');
const ErrorService = require('./errorService');
