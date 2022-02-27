export default {
    findBy: async function({ query, skip, limit, select, populate }: $TSFixMe) {
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
    },

    // create a new integration
    create: async function(
        projectId: $TSFixMe,
        userId: $TSFixMe,
        data: $TSFixMe,
        integrationType: $TSFixMe,
        notificationOptions: $TSFixMe
    ) {
        const _this = this;
        const integrationModel = new IntegrationModel(data);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Docum... Remove this comment to see the full error message
        integrationModel.projectId = projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdById' does not exist on type 'Doc... Remove this comment to see the full error message
        integrationModel.createdById = userId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Document<a... Remove this comment to see the full error message
        integrationModel.data = data;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'integrationType' does not exist on type ... Remove this comment to see the full error message
        integrationModel.integrationType = integrationType;
        data.monitors =
            data.monitors &&
            data.monitors.map((monitor: $TSFixMe) => ({
                monitorId: monitor,
            }));
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Docum... Remove this comment to see the full error message
        integrationModel.monitorId = data.monitorId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Docume... Remove this comment to see the full error message
        integrationModel.monitors = data.monitors || [];
        if (notificationOptions) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'notificationOptions' does not exist on t... Remove this comment to see the full error message
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
    },

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await IntegrationModel.countDocuments(query);
        return count;
    },

    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
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
    },

    findOneBy: async function({ query, select, populate }: $TSFixMe) {
        if (!query) query = {};

        if (query.deleted) query.deleted = false;
        let integrationQuery = IntegrationModel.findOne(query)
            .lean()
            .sort([['createdAt, -1']]);
        integrationQuery = handleSelect(select, integrationQuery);
        integrationQuery = handlePopulate(populate, integrationQuery);
        const result = await integrationQuery;

        return result;
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        const _this = this;
        if (!query) {
            query = {};
        }

        if (!data._id) {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 4.
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
    },

    updateBy: async function(query: $TSFixMe, data: $TSFixMe) {
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
    },

    removeMonitor: async function(monitorId: $TSFixMe, userId: $TSFixMe) {
        let query = {};
        if (monitorId) {
            query = { monitorId: monitorId };
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleted' does not exist on type '{}'.
        query.deleted = false;
        const integrations = await IntegrationModel.updateMany(query, {
            $set: {
                deleted: true,
                deletedAt: Date.now(),
                deletedById: userId,
            },
        });
        return integrations;
    },

    restoreBy: async function(query: $TSFixMe) {
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
                integration.map(async (integration: $TSFixMe) => {
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
    },
    hardDeleteBy: async function(query: $TSFixMe) {
        await IntegrationModel.deleteMany(query);
        return 'Integration(s) Removed Successfully!';
    },
};
import IntegrationModel from '../models/integration';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
