import SubscriberModel from '../models/subscriber';
import StatusPageService from './StatusPageService';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default class Service {
    async create(data: $TSFixMe) {
        const subscriberModel = new SubscriberModel();

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
        const subscriber = await subscriberModel.save();
        const populate = [
            { path: 'projectId', select: 'name _id' },
            { path: 'monitorId', select: 'name _id' },
            { path: 'statusPageId', select: 'name _id' },
        ];
        const select =
            '_id projectId monitorId statusPageId createdAt alertVia contactEmail contactPhone countryCode contactWebhook webhookMethod';
        return await this.findByOne({
            query: { _id: subscriber._id },
            select,
            populate,
        });
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const updatedSubscriber = await SubscriberModel.findOneAndUpdate(
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

    async updateBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        let updatedData = await SubscriberModel.updateMany(query, {
            $set: data,
        });

        const populate = [
            { path: 'projectId', select: 'name _id' },
            { path: 'monitorId', select: 'name _id' },
            { path: 'statusPageId', select: 'name _id' },
        ];
        const select =
            '_id projectId monitorId statusPageId createdAt alertVia contactEmail contactPhone countryCode contactWebhook webhookMethod';
        updatedData = await this.findBy({ query, select, populate });
        return updatedData;
    }

    async deleteBy(query: Query, userId: string) {
        const subscriber = await SubscriberModel.findOneAndUpdate(
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

    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        if (!skip) skip = 0;
        if (!limit) limit = 10;
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

        const subscriberQuery = SubscriberModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        subscriberQuery.select(select);
        subscriberQuery.populate(populate);

        const subscribers = await subscriberQuery;
        const subscribersArr = [];
        for (const result of subscribers) {
            const temp = {};

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

    async subscribersForAlert(query: Query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const subscribers = await SubscriberModel.find(query)
            .lean()
            .populate('projectId')
            .populate('monitorId')
            .populate('statusPageId');

        const subscribersArr = [];
        for (const result of subscribers) {
            const temp = {};

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

    async subscribe(data: $TSFixMe, monitors: $TSFixMe) {
        const populateStatusPage = [
            { path: 'monitors.monitor', select: '_id' },
        ];
        if (!monitors || (monitors && monitors.length < 1)) {
            const statusPage = await StatusPageService.findOneBy({
                query: { _id: data.statusPageId },
                select: 'monitors',
                populate: populateStatusPage,
            });

            monitors = statusPage.monitors.map(
                (monitorData: $TSFixMe) => monitorData.monitor
            );
        }

        const success = monitors.map(async (monitor: $TSFixMe) => {
            const newSubscriber = Object.assign({}, data, {
                monitorId: monitor._id ?? monitor,
            });
            const hasSubscribed = await this.subscriberCheck(newSubscriber);
            if (hasSubscribed) {
                const error = new Error(
                    'You are already subscribed to this monitor.'
                );

                error.code = 400;

                throw error;
            } else {
                if (newSubscriber.alertVia === 'email') {
                    const subscriberExist = await this.findByOne({
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
        const subscriber = await Promise.all(success);
        return subscriber;
    }

    async subscribeFromCSVFile(subscribers: $TSFixMe) {
        const { data, projectId, monitorId } = subscribers;
        const success = data.map(async (subscriber: $TSFixMe) => {
            const newSubscriber = Object.assign({}, subscriber, {
                monitorId,
                projectId,
            });
            const hasSubscribed = await this.subscriberCheck(newSubscriber);
            if (!hasSubscribed) {
                return await this.create(newSubscriber);
            }
            return [];
        });
        return await Promise.all(success);
    }

    async subscriberCheck(subscriber: $TSFixMe) {
        const existingSubscriber = await this.findByOne({
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

    async findByOne({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }
        query.deleted = false;

        const subscriberQuery = SubscriberModel.findOne(query)
            .sort(sort)
            .lean()
            .sort(sort);

        subscriberQuery.select(select);
        subscriberQuery.populate(populate);

        const subscriber = await subscriberQuery;
        return subscriber;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await SubscriberModel.countDocuments(query);
        return count;
    }

    async removeBy(query: Query) {
        await SubscriberModel.deleteMany(query);
        return 'Subscriber(s) removed successfully';
    }

    async hardDeleteBy(query: Query) {
        await SubscriberModel.deleteMany(query);
        return 'Subscriber(s) removed successfully';
    }

    async restoreBy(query: Query) {
        query.deleted = true;
        let subscriber = await this.findBy({ query, select: '_id' });
        if (subscriber && subscriber.length > 1) {
            const subscribers = await Promise.all(
                subscriber.map(async subscriber => {
                    const subscriberId = subscriber._id;
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
                const subscriberId = subscriber._id;
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
