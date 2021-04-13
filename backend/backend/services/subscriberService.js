module.exports = {
    create: async function(data) {
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
        subscriberModel.webhookMethod = data.webhookMethod || 'post';
        try {
            const subscriber = await subscriberModel.save();
            return await _this.findByOne({ _id: subscriber._id });
        } catch (error) {
            ErrorService.log('subscriberService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
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
        } catch (error) {
            ErrorService.log('subscriberService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await SubscriberModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('subscriberService.updateMany', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
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
        } catch (error) {
            ErrorService.log('subscriberService.deleteBy', error);
            throw error;
        }
    },

    findBy: async function(query, skip, limit) {
        try {
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
            const subscribers = await SubscriberModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId')
                .populate('monitorId')
                .populate('statusPageId');

            const subscribersArr = [];
            for (const result of subscribers) {
                const temp = {};
                temp._id = result._id;
                temp.projectId = result.projectId._id;
                temp.projectName = result.projectId.name;
                temp.monitorId = result.monitorId._id;
                temp.monitorName = result.monitorId.name;
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
        } catch (error) {
            ErrorService.log('subscriberService.find', error);
            throw error;
        }
    },

    subscribersForAlert: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const subscribers = await SubscriberModel.find(query)
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
                temp.monitorId = result.monitorId._id;
                temp.monitorName = result.monitorId.name;
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
        } catch (error) {
            ErrorService.log('subscriberService.subscribersForAlert', error);
            throw error;
        }
    },

    subscribe: async function(data, monitors) {
        try {
            const _this = this;
            if (!monitors || (monitors && monitors.length < 1)) {
                const statusPage = await StatusPageService.findOneBy({
                    _id: data.statusPageId,
                });
                monitors = statusPage.monitors.map(
                    monitorData => monitorData.monitor
                );
            }

            const success = monitors.map(async monitor => {
                const newSubscriber = Object.assign({}, data, {
                    monitorId: monitor._id,
                });
                const hasSubscribed = await _this.subscriberCheck(
                    newSubscriber
                );
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
                            monitorId: newSubscriber.monitorId,
                            contactEmail: newSubscriber.contactEmail,
                            subscribed: false,
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
        } catch (error) {
            ErrorService.log('SubscriberService.subscribe', error);
            throw error;
        }
    },

    subscribeFromCSVFile: async function(subscribers) {
        try {
            const _this = this;
            const { data, projectId, monitorId } = subscribers;
            const success = data.map(async subscriber => {
                const newSubscriber = Object.assign({}, subscriber, {
                    monitorId,
                    projectId,
                });
                const hasSubscribed = await _this.subscriberCheck(
                    newSubscriber
                );
                if (!hasSubscribed) {
                    return await _this.create(newSubscriber);
                }
                return [];
            });
            return await Promise.all(success);
        } catch (error) {
            ErrorService.log('SubscriberService.subscribeFromCSVFile', error);
            throw error;
        }
    },

    subscriberCheck: async function(subscriber) {
        const _this = this;
        const existingSubscriber = await _this.findByOne({
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
        });
        return existingSubscriber !== null;
    },

    findByOne: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const subscriber = await SubscriberModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .populate('monitorId', 'name');

            return subscriber;
        } catch (error) {
            ErrorService.log('SubscriberService.findByOne', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const count = await SubscriberModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('SubscriberService.countBy', error);
            throw error;
        }
    },

    removeBy: async function(query) {
        try {
            await SubscriberModel.deleteMany(query);
            return 'Subscriber(s) removed successfully';
        } catch (error) {
            ErrorService.log('SubscriberService.removeBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await SubscriberModel.deleteMany(query);
            return 'Subscriber(s) removed successfully';
        } catch (error) {
            ErrorService.log('SubscriberService.hardDeleteBy', error);
            throw error;
        }
    },

    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;
        let subscriber = await _this.findBy(query);
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

const SubscriberModel = require('../models/subscriber');
const ErrorService = require('./errorService');
const StatusPageService = require('./statusPageService');
