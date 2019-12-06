module.exports = {
    findBy: async function(query, skip, limit){
        if(!skip) skip=0;

        if(!limit) limit=0;

        if(typeof(skip) === 'string') skip = parseInt(skip);

        if(typeof(limit) === 'string') limit = parseInt(limit);

        if(!query) query = {};

        if(!query.deleted) query.deleted = false;
        try{
            var integrations = await IntegrationModel.find(query)
                .sort([['createdAt, -1']])
                .limit(limit)
                .skip(skip)
                .populate('createdById','name')
                .populate('projectId','name')
                .populate('monitors','name');
        }catch(error){
            ErrorService.log('IntegrationModel.find', error);
            throw error;
        }
        return integrations;
    },

    // create a new integration
    create: async function (projectId, userId, data, integrationType) {
        let _this = this;
        var integrationModel = new IntegrationModel(data);
        integrationModel.projectId = projectId;
        integrationModel.createdById = userId;
        integrationModel.data = data;
        integrationModel.integrationType = integrationType;
        integrationModel.monitors = [];
        if(data.monitorIds){
            for(let monitor of data.monitorIds){
                integrationModel.monitors.push(monitor);
            }
        }
        try {
            var integration = await integrationModel.save();
            integration = await _this.findOneBy({_id: integration._id});
        } catch (error) {
            ErrorService.log('integrationModel.save', error);
            throw error;
        }

        return integration;
    },

    countBy: async function(query){
        if(!query){
            query = {};
        }
        if(query.deleted) query.deleted = false;
        try{
            var count = await IntegrationModel.count(query);
        }catch(error){
            ErrorService.log('IntegrationModel.count', error);
            throw error;
        }
        return count;
    },

    deleteBy: async function(query, userId){
        if(!query){
            query = {};
        }
        if(!query.deleted) query.deleted = false;
        try{
            var integration = await IntegrationModel.findOneAndUpdate(query, {
                $set:{
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            });
        }catch(error){
            ErrorService.log('IntegrationModel.findOneAndUpdate', error);
            throw error;
        }
        return integration;
    },

    findOneBy: async function(query){

        if(!query) query = {};

        if(query.deleted) query.deleted = false;

        try{
            var integration = await IntegrationModel.findOne(query)
                .sort([['createdAt, -1']])
                .populate('createdById','name')
                .populate('projectId','name')
                .populate('monitors','name');
        }catch(error){
            ErrorService.log('IntegrationModel.findOne', error);
            throw error;
        }

        return integration;
    },

    update: async function(data){
        var _this = this;
        try {
            if(!data._id){
                let integration = await _this.create(data.projectId, data.userId, data, data.integrationType);
                return integration;
            }else{
                var integration = await _this.findOneBy({_id: data._id, deleted: { $ne: null }});    
                var updatedIntegration = await IntegrationModel.findOneAndUpdate({_id:integration._id, deleted:false}, {
                    $set: {
                        monitors: data.monitorIds,
                        'data.endpoint': data.endpoint,
                        'data.monitorIds':data.monitorIds,
                        'data.endpointType': data.endpointType
                    }
                }, { new: true });
                updatedIntegration = await _this.findOneBy({_id: updatedIntegration._id});
                return updatedIntegration;
            }
        } catch (error) {
            ErrorService.log('IntegrationService.findOneAndUpdate', error);
            throw error; 
        }
    },

    removeMonitor: async function(monitorId){
        let query = {};
        if(monitorId){
            query = {monitors:monitorId};
        }
        query.deleted = false;
        try{
            var integration = await IntegrationModel.findOneAndUpdate(query, {
                $pull:{monitors:monitorId,'data.monitorIds':monitorId.toString()}
            });
        }catch(error){
            ErrorService.log('IntegrationModel.findOneAndUpdate', error);
            throw error;
        }
        return integration;
    },

    restoreBy: async function(query){
        const _this = this;
        query.deleted = true;
        let integration = await _this.findBy(query);
        if(integration && integration.length > 1){
            const integrations = await Promise.all(integration.map(async (integration) => {
                const integrationId = integration._id;
                integration = await _this.update({
                    _id: integrationId,
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                return integration;
            }));
            return integrations;
        }else{
            integration = integration[0];
            if(integration){
                const integrationId = integration._id;
                integration = await _this.update({
                    _id: integrationId,
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
            }
            return integration;
        }
    }
};
var IntegrationModel = require('../models/integration');
var ErrorService = require('./errorService');

