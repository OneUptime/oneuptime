module.exports = {
    findBy: async function({ query, skip, limit, select, populate }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;
            let integrationQuery = IntegrationModel.find(query)
                .lean()
                .sort([['createdAt, -1']])
                .limit(limit)
                .skip(skip);
            integrationQuery = handleSelect(select, integrationQuery);
            integrationQuery = handlePopulate(populate, integrationQuery);
            const result = await integrationQuery;

            return result;
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
            data.monitors =
                data.monitors &&
                data.monitors.map(monitor => ({
                    monitorId: monitor,
                }));
            integrationModel.monitorId = data.monitorId || null;
            integrationModel.monitors = data.monitors || [];
            if (notificationOptions) {
                integrationModel.notificationOptions = notificationOptions;
            }

            let integration = await integrationModel.save();
            const select =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate = [
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: [{ path: 'componentId', select: 'name' }],
                },
            ];
            integration = await _this.findOneBy({
                query: { _id: integration._id },
                select,
                populate,
            });
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
            const count = await IntegrationModel.countDocuments(query);
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

    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) query = {};

            if (query.deleted) query.deleted = false;
            let integrationQuery = IntegrationModel.findOne(query)
                .lean()
                .sort([['createdAt, -1']]);
            integrationQuery = handleSelect(select, integrationQuery);
            integrationQuery = handlePopulate(populate, integrationQuery);
            const result = await integrationQuery;

            return result;
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
                            monitors: data.monitors,
                            'data.webHookName': data.webHookName,
                            'data.endpoint': data.endpoint,
                            'data.monitors': data.monitors,
                            'data.endpointType': data.endpointType,
                            'notificationOptions.incidentCreated':
                                data.incidentCreated,
                            'notificationOptions.incidentResolved':
                                data.incidentResolved,
                            'notificationOptions.incidentAcknowledged':
                                data.incidentAcknowledged,
                            'notificationOptions.incidentNoteAdded':
                                data.incidentNoteAdded,
                        },
                    },
                    { new: true }
                );
                const select =
                    'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
                const populate = [
                    { path: 'createdById', select: 'name' },
                    { path: 'projectId', select: 'name' },
                    {
                        path: 'monitors.monitorId',
                        select: 'name',
                        populate: [{ path: 'componentId', select: 'name' }],
                    },
                ];
                updatedIntegration = await _this.findOneBy({
                    query: { _id: updatedIntegration._id },
                    select,
                    populate,
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
            const select =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate = [
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: [{ path: 'componentId', select: 'name' }],
                },
            ];
            updatedData = await this.findBy({ query, select, populate });
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
        try {
            const _this = this;
            query.deleted = true;
            const select =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate = [
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: [{ path: 'componentId', select: 'name' }],
                },
            ];
            const integration = await _this.findBy({ query, select, populate });
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
            }
        } catch (error) {
            ErrorService.log('integrationService.restoreBy', error);
            throw error;
        }
    },
    hardDeleteBy: async function(query) {
        try {
            await IntegrationModel.deleteMany(query);
            return 'Integration(s) Removed Successfully!';
        } catch (error) {
            ErrorService.log('Integration.hardDeleteBy', error);
            throw error;
        }
    },
};
const IntegrationModel = require('../models/integration');
const ErrorService = require('./errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
