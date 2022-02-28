export default {
    create: async function(data: $TSFixMe) {
        const _this = this;
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
        return await _this.findByOne({
            query: { _id: subscriber._id },
            select,
            populate,
        });
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
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
    },

    updateBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
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
    },

    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
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
    },

    findBy: async function({ query, skip, limit, select, populate }: $TSFixMe) {
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

        let subscriberQuery = SubscriberModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        subscriberQuery = handleSelect(select, subscriberQuery);
        subscriberQuery = handlePopulate(populate, subscriberQuery);

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
    },

    subscribersForAlert: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const subscribers = await SubscriberModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
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
    },

    subscribe: async function(data: $TSFixMe, monitors: $TSFixMe) {
        const _this = this;
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
            const hasSubscribed = await _this.subscriberCheck(newSubscriber);
            if (hasSubscribed) {
                const error = new Error(
                    'You are already subscribed to this monitor.'
                );

                error.code = 400;
                ErrorService.log('SubscriberService.subscribe', error);
                throw error;
            } else {
                if (newSubscriber.alertVia === 'email') {
                    const subscriberExist = await _this.findByOne({
                        query: {
                            monitorId: newSubscriber.monitorId,
                            contactEmail: newSubscriber.contactEmail,
                            subscribed: false,
                        },
                        select: '_id',
                    });
                    if (subscriberExist) {
                        return await _this.updateOneBy(
                            {
                                monitorId: newSubscriber.monitorId,
                                contactEmail: newSubscriber.contactEmail,
                            },
                            { subscribed: true }
                        );
                    } else {
                        return await _this.create(newSubscriber);
                    }
                } else {
                    return await _this.create(newSubscriber);
                }
            }
        });
        const subscriber = await Promise.all(success);
        return subscriber;
    },

    subscribeFromCSVFile: async function(subscribers: $TSFixMe) {
        const _this = this;
        const { data, projectId, monitorId } = subscribers;
        const success = data.map(async (subscriber: $TSFixMe) => {
            const newSubscriber = Object.assign({}, subscriber, {
                monitorId,
                projectId,
            });
            const hasSubscribed = await _this.subscriberCheck(newSubscriber);
            if (!hasSubscribed) {
                return await _this.create(newSubscriber);
            }
            return [];
        });
        return await Promise.all(success);
    },

    subscriberCheck: async function(subscriber: $TSFixMe) {
        const _this = this;
        const existingSubscriber = await _this.findByOne({
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
    },

    findByOne: async function({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }
        query.deleted = false;

        let subscriberQuery = SubscriberModel.findOne(query)
            .lean()
            .sort([['createdAt', -1]]);

        subscriberQuery = handleSelect(select, subscriberQuery);
        subscriberQuery = handlePopulate(populate, subscriberQuery);

        const subscriber = await subscriberQuery;
        return subscriber;
    },

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await SubscriberModel.countDocuments(query);
        return count;
    },

    removeBy: async function(query: $TSFixMe) {
        await SubscriberModel.deleteMany(query);
        return 'Subscriber(s) removed successfully';
    },

    hardDeleteBy: async function(query: $TSFixMe) {
        await SubscriberModel.deleteMany(query);
        return 'Subscriber(s) removed successfully';
    },

    restoreBy: async function(query: $TSFixMe) {
        const _this = this;
        query.deleted = true;
        let subscriber = await _this.findBy({ query, select: '_id' });
        if (subscriber && subscriber.length > 1) {
            const subscribers = await Promise.all(
                subscriber.map(async subscriber => {
                    const subscriberId = subscriber._id;
                    subscriber = await _this.updateOneBy(
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
                subscriber = await _this.updateOneBy(
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
    },
};

import SubscriberModel from '../models/subscriber';
import ErrorService from 'common-server/utils/error';
import StatusPageService from './statusPageService';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
