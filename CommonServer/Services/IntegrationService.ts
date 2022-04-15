export default class Service {
    public async findBy({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy): void {
        if (!query.deleted) {
            query.deleted = false;
        }
        const integrationQuery: $TSFixMe = IntegrationModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());
        integrationQuery.select(select);
        integrationQuery.populate(populate);
        const result: $TSFixMe = await integrationQuery;

        return result;
    }

    // Create a new integration
    public async create(
        projectId: ObjectID,
        userId: ObjectID,
        data: $TSFixMe,
        integrationType: $TSFixMe,
        notificationOptions: $TSFixMe
    ): void {
        const integrationModel: $TSFixMe = new IntegrationModel(data);

        integrationModel.projectId = projectId;

        integrationModel.createdById = userId;

        integrationModel.data = data;

        integrationModel.integrationType = integrationType;
        data.monitors =
            data.monitors &&
            data.monitors.map((monitor: $TSFixMe) => {
                return {
                    monitorId: monitor,
                };
            });

        integrationModel.monitorId = data.monitorId || null;

        integrationModel.monitors = data.monitors || [];
        if (notificationOptions) {
            integrationModel.notificationOptions = notificationOptions;
        }

        let integration: $TSFixMe = await integrationModel.save();
        const select: $TSFixMe =
            'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
        const populate: $TSFixMe = [
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: [{ path: 'componentId', select: 'name' }],
            },
        ];
        integration = await this.findOneBy({
            query: { _id: integration._id },
            select,
            populate,
        });
        return integration;
    }

    public async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count: $TSFixMe = await IntegrationModel.countDocuments(query);
        return count;
    }

    public async deleteBy(query: Query, userId: ObjectID): void {
        if (!query) {
            query = {};
        }
        if (!query.deleted) {
            query.deleted = false;
        }
        const integration: $TSFixMe = await IntegrationModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            }
        );
        return integration;
    }

    public async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        if (query.deleted) {
            query.deleted = false;
        }
        const integrationQuery: $TSFixMe = IntegrationModel.findOne(query)
            .lean()
            .sort(sort);
        integrationQuery.select(select);
        integrationQuery.populate(populate);
        const result: $TSFixMe = await integrationQuery;

        return result;
    }

    public async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!data._id) {
            const integration: $TSFixMe = await this.create(
                data.projectId,
                data.userId,
                data,
                data.integrationType
            );
            return integration;
        } else {
            query.deleted = false;

            let updatedIntegration: $TSFixMe =
                await IntegrationModel.findOneAndUpdate(
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
            const select: $TSFixMe =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate: $TSFixMe = [
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: [{ path: 'componentId', select: 'name' }],
                },
            ];
            updatedIntegration = await this.findOneBy({
                query: { _id: updatedIntegration._id },
                select,
                populate,
            });
            return updatedIntegration;
        }
    }

    public async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        let updatedData: $TSFixMe = await IntegrationModel.updateMany(query, {
            $set: data,
        });
        const select: $TSFixMe =
            'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
        const populate: $TSFixMe = [
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
    }

    public async removeMonitor(monitorId: $TSFixMe, userId: ObjectID): void {
        let query: $TSFixMe = {};
        if (monitorId) {
            query = { monitorId: monitorId };
        }

        query.deleted = false;
        const integrations: $TSFixMe = await IntegrationModel.updateMany(
            query,
            {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            }
        );
        return integrations;
    }

    public async restoreBy(query: Query): void {
        query.deleted = true;
        const select: $TSFixMe =
            'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
        const populate: $TSFixMe = [
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: [{ path: 'componentId', select: 'name' }],
            },
        ];
        const integration: $TSFixMe = await this.findBy({
            query,
            select,
            populate,
        });
        if (integration && integration.length > 1) {
            const integrations: $TSFixMe = await Promise.all(
                integration.map(async (integration: $TSFixMe) => {
                    const integrationId: $TSFixMe = integration._id;
                    integration = await this.updateOneBy(
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
    }
}
import IntegrationModel from '../Models/integration';
import ObjectID from 'Common/Types/ObjectID';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
