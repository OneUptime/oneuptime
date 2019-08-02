module.exports = {
    findBy: async function(query, skip, limit){
        if(!skip) skip=0;

        if(!limit) limit=0;

        if(typeof(skip) === 'string') skip = parseInt(skip);

        if(typeof(limit) === 'string') limit = parseInt(limit);

        if(!query) query = {};

        query.deleted = false;
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
        try{
            var integration = await integrationModel.save();
        }catch(error){
            ErrorService.log('integrationModel.save', error);
            throw error;
        }
        try{
            integration = await _this.findOneBy({_id: integration._id});
        }catch(error){
            ErrorService.log('IntegrationService.findOneBy', error);
            throw error;
        }
        return integration;
    },

    countBy: async function(query){
        if(!query){
            query = {};
        }
        query.deleted = false;
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
        query.deleted = false;
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

        query.deleted = false;

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
        if(!data._id){
            try{
                let integration = await _this.create(data.projectId, data.userId, data, data.integrationType);
                return integration;
            }catch(error){
                ErrorService.log('IntegrationService.create', error);
                throw error;
            }
        }else{
            try{
                var integration = await _this.findOneBy({_id: data._id});
            }catch(error){
                ErrorService.log('IntegrationService.findOneBy', error);
                throw error;
            }

            try{
                var updatedIntegration = await IntegrationModel.findOneAndUpdate({_id:integration._id, deleted:false}, {
                    $set: {
                        monitors: data.monitorIds,
                        'data.endpoint': data.endpoint,
                        'data.monitorIds':data.monitorIds,
                        'data.endpointType': data.endpointType
                    }
                }, { new: true });
            }catch(error){
                ErrorService.log('IntegrationModel.findOneAndUpdate', error);
                throw error;
            }
            try{
                updatedIntegration = await _this.findOneBy({_id: updatedIntegration._id});
            }catch(error){
                ErrorService.log('IntegrationService.findOneBy', error);
                throw error;
            }
            return updatedIntegration;
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

};
var IntegrationModel = require('../models/integration');
var ErrorService = require('./errorService');

