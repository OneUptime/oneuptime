export default {
    findBy: async function ({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy) {
        if (!query['deleted']) query['deleted'] = false;
        let integrationQuery = IntegrationModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());
        integrationQuery = handleSelect(select, integrationQuery);
        integrationQuery = handlePopulate(populate, integrationQuery);
        const result = await integrationQuery;

        return result;
    },

    // create a new integration
    create: async function (
        projectId: $TSFixMe,
        userId: string,
        data: $TSFixMe,
        integrationType: $TSFixMe,
        notificationOptions: $TSFixMe
    ) {
        const _this = this;
        const integrationModel = new IntegrationModel(data);

        integrationModel.projectId = projectId;

        integrationModel.createdById = userId;

        integrationModel.data = data;

        integrationModel.integrationType = integrationType;
        data.monitors =
            data.monitors &&
            data.monitors.map((monitor: $TSFixMe) => ({
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
    },

    countBy: async function (query: Query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await IntegrationModel.countDocuments(query);
        return count;
    },

    deleteBy: async function (query: Query, userId: string) {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) query['deleted'] = false;
        const integration = await IntegrationModel.findOneAndUpdate(query, {
            $set: {
                deleted: true,
                deletedById: userId,
                deletedAt: Date.now(),
            },
        });
        return integration;
    },

    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (query.deleted) query.deleted = false;
        let integrationQuery = IntegrationModel.findOne(query)
            .lean()
            .sort(sort);
        integrationQuery = handleSelect(select, integrationQuery);
        integrationQuery = handlePopulate(populate, integrationQuery);
        const result = await integrationQuery;

        return result;
    },

    updateOneBy: async function (query: Query, data: $TSFixMe) {
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
    },

    updateBy: async function (query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
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

    removeMonitor: async function (monitorId: $TSFixMe, userId: string) {
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
    },

    restoreBy: async function (query: Query) {
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
    hardDeleteBy: async function (query: Query) {
        await IntegrationModel.deleteMany(query);
        return 'Integration(s) Removed Successfully!';
    },
};
import IntegrationModel from 'common-server/models/integration';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
import FindOneBy from 'common-server/types/db/FindOneBy';
import FindBy from 'common-server/types/db/FindBy';
import Query from 'common-server/types/db/Query';
