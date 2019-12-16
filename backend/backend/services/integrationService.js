module.exports = {
    findBy: async function (query, skip, limit) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof (skip) === 'string') skip = parseInt(skip);

            if (typeof (limit) === 'string') limit = parseInt(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;
            var integrations = await IntegrationModel.find(query)
                .sort([['createdAt, -1']])
                .limit(limit)
                .skip(skip)
                .populate('createdById','name')
                .populate('projectId','name')
                .populate('monitorId','name');
            return integrations;
        } catch (error) {
            ErrorService.log('IntegrationService.findBy', error);
            throw error;
        }
    },

    // create a new integration
    create: async function (projectId, userId, data, integrationType) {
        try {
            let _this = this;
            var integrationModel = new IntegrationModel(data);
            integrationModel.projectId = projectId;
            integrationModel.createdById = userId;
            integrationModel.data = data;
            integrationModel.integrationType = integrationType;
            integrationModel.monitorId = data.monitorId;

            var integration = await integrationModel.save();
            integration = await _this.findOneBy({ _id: integration._id });
            return integration;
        } catch (error) {
            ErrorService.log('IntegrationService.create', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var count = await IntegrationModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('IntegrationService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function (query, userId) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;
            var integration = await IntegrationModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            });
            return integration;
        } catch (error) {
            ErrorService.log('IntegrationService.deleteBy', error);
            throw error;
        }
    },

    findOneBy: async function (query) {
        try {
            if (!query) query = {};

            if (query.deleted) query.deleted = false;
            var integration = await IntegrationModel.findOne(query)
                .sort([['createdAt, -1']])
                .populate('createdById','name')
                .populate('projectId','name')
                .populate('monitorId','name');
            return integration;
        } catch (error) {
            ErrorService.log('IntegrationService.findOneBy', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            var _this = this;
            if (!query) {
                query = {};
            }

            if (!data._id) {
                let integration = await _this.create(data.projectId, data.userId, data, data.integrationType);
                return integration;
            } else {
                query.deleted = false;
                var updatedIntegration = await IntegrationModel.findOneAndUpdate(query, {
                    $set: {
                        monitorId: data.monitorId,
                        'data.endpoint': data.endpoint,
                        'data.monitorId':data.monitorId,
                        'data.endpointType': data.endpointType
                    }
                }, { new: true });
                updatedIntegration = await _this.findOneBy({_id: updatedIntegration._id});
                return updatedIntegration;
            }
        } catch (error) {
            ErrorService.log('IntegrationService.update', error);
            throw error; 
        }
    },

    removeMonitor: async function(monitorId, userId){
        try{
            let query = {};
            if(monitorId){
                query = {monitorId:monitorId};
            }
            query.deleted = false;
            var integrations = await IntegrationModel.updateMany(query, {
                $set: { deleted: true, deletedAt: Date.now(), deletedById: userId }
            });
            return integrations;
        }catch(error){
            ErrorService.log('IntegrationService.removeMonitor', error);
            throw error;
        }
    },

    restoreBy: async function (query) {
        const _this = this;
        query.deleted = true;
        let integration = await _this.findBy(query);
        if (integration && integration.length > 1) {
            const integrations = await Promise.all(integration.map(async (integration) => {
                const integrationId = integration._id;
                integration = await _this.updateOneBy({
                    _id: integrationId
                }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                return integration;
            }));
            return integrations;
        } else {
            integration = integration[0];
            if (integration) {
                const integrationId = integration._id;
                integration = await _this.updateOneBy({
                    _id: integrationId
                }, {
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
