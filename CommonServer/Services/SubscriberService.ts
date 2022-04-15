import SubscriberModel from '../Models/subscriber';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageService from './StatusPageService';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    public async create(data: $TSFixMe): void {
        const subscriberModel: $TSFixMe = new SubscriberModel();

        subscriberModel.projectId = data.projectId || null;

        subscriberModel.monitorId = data.monitorId || null;

        subscriberModel.statusPageId = data.statusPageId || null;

        subscriberModel.alertVia = data.alertVia || null;

        subscriberModel.contactEmail = data.contactEmail || null;

        subscriberModel.contactPhone = data.contactPhone || null;

        subscriberModel.countryCode = data.countryCode || null;

        subscriberModel.contactWebhook = data.contactWebhook || null;

        subscriberModel.notificationType = data.notificationType || null;

        subscriberModel.webhookMethod = data.webhookMethod || 'post';
        const subscriber: $TSFixMe = await subscriberModel.save();
        const populate: $TSFixMe = [
            { path: 'projectId', select: 'name _id' },
            { path: 'monitorId', select: 'name _id' },
            { path: 'statusPageId', select: 'name _id' },
        ];
        const select: $TSFixMe =
            '_id projectId monitorId statusPageId createdAt alertVia contactEmail contactPhone countryCode contactWebhook webhookMethod';
        return await this.findByOne({
            query: { _id: subscriber._id },
            select,
            populate,
        });
    }

    public async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        const updatedSubscriber: $TSFixMe =
            await SubscriberModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
        return updatedSubscriber;
    }

    public async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        let updatedData: $TSFixMe = await SubscriberModel.updateMany(query, {
            $set: data,
        });

        const populate: $TSFixMe = [
            { path: 'projectId', select: 'name _id' },
            { path: 'monitorId', select: 'name _id' },
            { path: 'statusPageId', select: 'name _id' },
        ];
        const select: $TSFixMe =
            '_id projectId monitorId statusPageId createdAt alertVia contactEmail contactPhone countryCode contactWebhook webhookMethod';
        updatedData = await this.findBy({ query, select, populate });
        return updatedData;
    }

    public async deleteBy(query: Query, userId: ObjectID): void {
        const subscriber: $TSFixMe = await SubscriberModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            },
            {
                new: true,
            }
        );
        return subscriber;
    }

    public async findBy({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy): void {
        if (!skip) {
            skip = 0;
        }
        if (!limit) {
            limit = 10;
        }
        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        query.deleted = false;

        const subscriberQuery: $TSFixMe = SubscriberModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        subscriberQuery.select(select);
        subscriberQuery.populate(populate);

        const subscribers: $TSFixMe = await subscriberQuery;
        const subscribersArr: $TSFixMe = [];
        for (const result of subscribers) {
            const temp: $TSFixMe = {};

            temp._id = result._id;

            temp.projectId = result.projectId._id;

            temp.projectName = result.projectId.name;

            temp.monitorId = result.monitorId ? result.monitorId._id : null;

            temp.monitorName = result.monitorId ? result.monitorId.name : null;

            temp.statusPageId = result.statusPageId
                ? result.statusPageId._id
                : null;

            temp.statusPageName = result.statusPageId
                ? result.statusPageId.name
                : null;

            temp.createdAt = result.createdAt;

            temp.alertVia = result.alertVia;

            temp.contactEmail = result.contactEmail;

            temp.contactPhone = result.contactPhone;

            temp.countryCode = result.countryCode;

            temp.contactWebhook = result.contactWebhook;

            temp.webhookMethod = result.webhookMethod;
            subscribersArr.push(temp);
        }
        return subscribersArr;
    }

    public async subscribersForAlert(query: Query): void {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const subscribers: $TSFixMe = await SubscriberModel.find(query)
            .lean()
            .populate('projectId')
            .populate('monitorId')
            .populate('statusPageId');

        const subscribersArr: $TSFixMe = [];
        for (const result of subscribers) {
            const temp: $TSFixMe = {};

            temp._id = result._id;

            temp.projectId = result.projectId._id;

            temp.projectName = result.projectId.name;

            temp.monitorId = result.monitorId ? result.monitorId._id : null;

            temp.monitorName = result.monitorId ? result.monitorId.name : null;

            temp.statusPageId = result.statusPageId
                ? result.statusPageId._id
                : null;

            temp.statusPageName = result.statusPageId
                ? result.statusPageId.name
                : null;

            temp.createdAt = result.createdAt;

            temp.alertVia = result.alertVia;

            temp.contactEmail = result.contactEmail;

            temp.contactPhone = result.contactPhone;

            temp.countryCode = result.countryCode;

            temp.contactWebhook = result.contactWebhook;

            temp.webhookMethod = result.webhookMethod;

            temp.notificationType = result.notificationType;
            subscribersArr.push(temp);
        }
        return subscribersArr;
    }

    public async subscribe(data: $TSFixMe, monitors: $TSFixMe): void {
        const populateStatusPage: $TSFixMe = [
            { path: 'monitors.monitor', select: '_id' },
        ];
        if (!monitors || (monitors && monitors.length < 1)) {
            const statusPage: $TSFixMe = await StatusPageService.findOneBy({
                query: { _id: data.statusPageId },
                select: 'monitors',
                populate: populateStatusPage,
            });

            monitors = statusPage.monitors.map((monitorData: $TSFixMe) => {
                return monitorData.monitor;
            });
        }

        const success: $TSFixMe = monitors.map(async (monitor: $TSFixMe) => {
            const newSubscriber: $TSFixMe = Object.assign({}, data, {
                monitorId: monitor._id ?? monitor,
            });
            const hasSubscribed: $TSFixMe = await this.subscriberCheck(
                newSubscriber
            );
            if (hasSubscribed) {
                const error: $TSFixMe = new Error(
                    'You are already subscribed to this monitor.'
                );

                error.code = 400;

                throw error;
            } else {
                if (newSubscriber.alertVia === 'email') {
                    const subscriberExist: $TSFixMe = await this.findByOne({
                        query: {
                            monitorId: newSubscriber.monitorId,
                            contactEmail: newSubscriber.contactEmail,
                            subscribed: false,
                        },
                        select: '_id',
                    });
                    if (subscriberExist) {
                        return await this.updateOneBy(
                            {
                                monitorId: newSubscriber.monitorId,
                                contactEmail: newSubscriber.contactEmail,
                            },
                            { subscribed: true }
                        );
                    } else {
                        return await this.create(newSubscriber);
                    }
                } else {
                    return await this.create(newSubscriber);
                }
            }
        });
        const subscriber: $TSFixMe = await Promise.all(success);
        return subscriber;
    }

    public async subscribeFromCSVFile(subscribers: $TSFixMe): void {
        const { data, projectId, monitorId }: $TSFixMe = subscribers;
        const success: $TSFixMe = data.map(async (subscriber: $TSFixMe) => {
            const newSubscriber: $TSFixMe = Object.assign({}, subscriber, {
                monitorId,
                projectId,
            });
            const hasSubscribed: $TSFixMe = await this.subscriberCheck(
                newSubscriber
            );
            if (!hasSubscribed) {
                return await this.create(newSubscriber);
            }
            return [];
        });
        return await Promise.all(success);
    }

    public async subscriberCheck(subscriber: $TSFixMe): void {
        const existingSubscriber: $TSFixMe = await this.findByOne({
            query: {
                monitorId: subscriber.monitorId,
                subscribed: true,
                ...(subscriber.statusPageId && {
                    statusPageId: subscriber.statusPageId,
                }),
                ...(subscriber.alertVia === 'sms' && {
                    contactPhone: subscriber.contactPhone,
                    countryCode: subscriber.countryCode,
                }),
                ...(subscriber.alertVia === 'email' && {
                    contactEmail: subscriber.contactEmail,
                }),
                ...(subscriber.alertVia === 'webhook' && {
                    contactWebhook: subscriber.contactWebhook,
                    contactEmail: subscriber.contactEmail,
                }),
            },
            select: '_id',
        });
        return existingSubscriber !== null;
    }

    public async findByOne({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }
        query.deleted = false;

        const subscriberQuery: $TSFixMe = SubscriberModel.findOne(query)
            .sort(sort)
            .lean()
            .sort(sort);

        subscriberQuery.select(select);
        subscriberQuery.populate(populate);

        const subscriber: $TSFixMe = await subscriberQuery;
        return subscriber;
    }

    public async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count: $TSFixMe = await SubscriberModel.countDocuments(query);
        return count;
    }

    public async removeBy(query: Query): void {
        await SubscriberModel.deleteMany(query);
        return 'Subscriber(s) removed successfully';
    }

    public async restoreBy(query: Query): void {
        query.deleted = true;
        let subscriber: $TSFixMe = await this.findBy({ query, select: '_id' });
        if (subscriber && subscriber.length > 1) {
            const subscribers: $TSFixMe = await Promise.all(
                subscriber.map(async (subscriber: $TSFixMe) => {
                    const subscriberId: $TSFixMe = subscriber._id;
                    subscriber = await this.updateOneBy(
                        { _id: subscriberId, deleted: true },
                        {
                            deleted: false,
                            deletedAt: null,
                            deleteBy: null,
                        }
                    );
                    return subscriber;
                })
            );
            return subscribers;
        } else {
            subscriber = subscriber[0];
            if (subscriber) {
                const subscriberId: $TSFixMe = subscriber._id;
                subscriber = await this.updateOneBy(
                    { _id: subscriberId, deleted: true },
                    {
                        deleted: false,
                        deletedAt: null,
                        deleteBy: null,
                    }
                );
            }
            return subscriber;
        }
    }
}
