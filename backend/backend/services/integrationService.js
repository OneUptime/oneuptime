module.exports = {
    findBy: async function(query, skip, limit) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;
            const integrations = await IntegrationModel.find(query)
                .sort([['createdAt, -1']])
                .limit(limit)
                .skip(skip)
                .populate('createdById', 'name')
                .populate('projectId', 'name')
                .populate('monitorId', 'name');
            return integrations;
        } catch (error) {
            ErrorService.log('IntegrationService.findBy', error);
            throw error;
        }
    },

    // create a new integration
    create: async function(
        projectId,
        userId,
        data,
        integrationType,
        notificationOptions
    ) {
        try {
            const _this = this;
            const integrationModel = new IntegrationModel(data);
            integrationModel.projectId = projectId;
            integrationModel.createdById = userId;
            integrationModel.data = data;
            integrationModel.integrationType = integrationType;
            integrationModel.monitorId = data.monitorId;
            if (notificationOptions) {
                integrationModel.notificationOptions = notificationOptions;
            }

            let integration = await integrationModel.save();
            integration = await _this.findOneBy({ _id: integration._id });
            return integration;
        } catch (error) {
            ErrorService.log('IntegrationService.create', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const count = await IntegrationModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('IntegrationService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;
            const integration = await IntegrationModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            });
            return integration;
        } catch (error) {
            ErrorService.log('IntegrationService.deleteBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (query.deleted) query.deleted = false;
            const integration = await IntegrationModel.findOne(query)
                .sort([['createdAt, -1']])
                .populate('createdById', 'name')
                .populate('projectId', 'name')
                .populate('monitorId', 'name');
            return integration;
        } catch (error) {
            ErrorService.log('IntegrationService.findOneBy', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            const _this = this;
            if (!query) {
                query = {};
            }

            if (!data._id) {
                const integration = await _this.create(
                    data.projectId,
                    data.userId,
                    data,
                    data.integrationType
                );
                return integration;
            } else {
                query.deleted = false;
                let updatedIntegration = await IntegrationModel.findOneAndUpdate(
                    query,
                    {
                        $set: {
                            monitorId: data.monitorId,
                            'data.endpoint': data.endpoint,
                            'data.monitorId': data.monitorId,
                            'data.endpointType': data.endpointType,
                            'notificationOptions.incidentCreated':
                                data.incidentCreated,
                            'notificationOptions.incidentResolved':
                                data.incidentResolved,
                            'notificationOptions.incidentAcknowledged':
                                data.incidentAcknowledged,
                        },
                    },
                    { new: true }
                );
                updatedIntegration = await _this.findOneBy({
                    _id: updatedIntegration._id,
                });
                return updatedIntegration;
            }
        } catch (error) {
            ErrorService.log('IntegrationService.update', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await IntegrationModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('IntegrationService.updateMany', error);
            throw error;
        }
    },

    removeMonitor: async function(monitorId, userId) {
        try {
            let query = {};
            if (monitorId) {
                query = { monitorId: monitorId };
            }
            query.deleted = false;
            const integrations = await IntegrationModel.updateMany(query, {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            });
            return integrations;
        } catch (error) {
            ErrorService.log('IntegrationService.removeMonitor', error);
            throw error;
        }
    },

    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;
        let integration = await _this.findBy(query);
        if (integration && integration.length > 1) {
            const integrations = await Promise.all(
                integration.map(async integration => {
                    const integrationId = integration._id;
                    integration = await _this.updateOneBy(
                        {
                            _id: integrationId,
                        },
                        {
                            deleted: false,
                            deletedAt: null,
                            deleteBy: null,
                        }
                    );
                    return integration;
                })
            );
            return integrations;
        } else {
            integration = integration[0];
            if (integration) {
                const integrationId = integration._id;
                integration = await _this.updateOneBy(
                    {
                        _id: integrationId,
                    },
                    {
                        deleted: false,
                        deletedAt: null,
                        deleteBy: null,
                    }
                );
            }
            return integration;
        }
    },
};
const IntegrationModel = require('../models/integration');
const ErrorService = require('./errorService');
