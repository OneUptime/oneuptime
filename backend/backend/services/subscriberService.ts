export default {
    create: async function(data: $TSFixMe) {
        const _this = this;
        const subscriberModel = new SubscriberModel();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Docum... Remove this comment to see the full error message
        subscriberModel.projectId = data.projectId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Docum... Remove this comment to see the full error message
        subscriberModel.monitorId = data.monitorId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageId' does not exist on type 'Do... Remove this comment to see the full error message
        subscriberModel.statusPageId = data.statusPageId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'alertVia' does not exist on type 'Docume... Remove this comment to see the full error message
        subscriberModel.alertVia = data.alertVia || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'contactEmail' does not exist on type 'Do... Remove this comment to see the full error message
        subscriberModel.contactEmail = data.contactEmail || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'contactPhone' does not exist on type 'Do... Remove this comment to see the full error message
        subscriberModel.contactPhone = data.contactPhone || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'countryCode' does not exist on type 'Doc... Remove this comment to see the full error message
        subscriberModel.countryCode = data.countryCode || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'contactWebhook' does not exist on type '... Remove this comment to see the full error message
        subscriberModel.contactWebhook = data.contactWebhook || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'notificationType' does not exist on type... Remove this comment to see the full error message
        subscriberModel.notificationType = data.notificationType || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'webhookMethod' does not exist on type 'D... Remove this comment to see the full error message
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

    findBy: async function({
        query,
        skip,
        limit,
        select,
        populate
    }: $TSFixMe) {
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
            temp._id = result._id;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type '{}'.
            temp.projectId = result.projectId._id;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectName' does not exist on type '{}'... Remove this comment to see the full error message
            temp.projectName = result.projectId.name;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
            temp.monitorId = result.monitorId ? result.monitorId._id : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorName' does not exist on type '{}'... Remove this comment to see the full error message
            temp.monitorName = result.monitorId ? result.monitorId.name : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageId' does not exist on type '{}... Remove this comment to see the full error message
            temp.statusPageId = result.statusPageId
                ? result.statusPageId._id
                : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageName' does not exist on type '... Remove this comment to see the full error message
            temp.statusPageName = result.statusPageId
                ? result.statusPageId.name
                : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdAt' does not exist on type '{}'.
            temp.createdAt = result.createdAt;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'alertVia' does not exist on type '{}'.
            temp.alertVia = result.alertVia;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'contactEmail' does not exist on type '{}... Remove this comment to see the full error message
            temp.contactEmail = result.contactEmail;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'contactPhone' does not exist on type '{}... Remove this comment to see the full error message
            temp.contactPhone = result.contactPhone;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'countryCode' does not exist on type '{}'... Remove this comment to see the full error message
            temp.countryCode = result.countryCode;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'contactWebhook' does not exist on type '... Remove this comment to see the full error message
            temp.contactWebhook = result.contactWebhook;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'webhookMethod' does not exist on type '{... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
            temp._id = result._id;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type '{}'.
            temp.projectId = result.projectId._id;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectName' does not exist on type '{}'... Remove this comment to see the full error message
            temp.projectName = result.projectId.name;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
            temp.monitorId = result.monitorId ? result.monitorId._id : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorName' does not exist on type '{}'... Remove this comment to see the full error message
            temp.monitorName = result.monitorId ? result.monitorId.name : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageId' does not exist on type '{}... Remove this comment to see the full error message
            temp.statusPageId = result.statusPageId
                ? result.statusPageId._id
                : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageName' does not exist on type '... Remove this comment to see the full error message
            temp.statusPageName = result.statusPageId
                ? result.statusPageId.name
                : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdAt' does not exist on type '{}'.
            temp.createdAt = result.createdAt;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'alertVia' does not exist on type '{}'.
            temp.alertVia = result.alertVia;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'contactEmail' does not exist on type '{}... Remove this comment to see the full error message
            temp.contactEmail = result.contactEmail;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'contactPhone' does not exist on type '{}... Remove this comment to see the full error message
            temp.contactPhone = result.contactPhone;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'countryCode' does not exist on type '{}'... Remove this comment to see the full error message
            temp.countryCode = result.countryCode;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'contactWebhook' does not exist on type '... Remove this comment to see the full error message
            temp.contactWebhook = result.contactWebhook;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'webhookMethod' does not exist on type '{... Remove this comment to see the full error message
            temp.webhookMethod = result.webhookMethod;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'notificationType' does not exist on type... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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

    findByOne: async function({
        query,
        select,
        populate
    }: $TSFixMe) {
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
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
            // @ts-expect-error ts-migrate(2740) FIXME: Type '{}' is missing the following properties from... Remove this comment to see the full error message
            subscriber = subscriber[0];
            if (subscriber) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}[]'.
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

import SubscriberModel from '../models/subscriber'
import ErrorService from 'common-server/utils/error'
import StatusPageService from './statusPageService'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'
