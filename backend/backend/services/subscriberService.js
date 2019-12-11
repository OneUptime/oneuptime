module.exports = {
    create: async function (data) {
        var _this = this;
        var subscriberModel = new SubscriberModel();
        subscriberModel.projectId = data.projectId || null;
        subscriberModel.monitorId = data.monitorId || null;
        subscriberModel.statusPageId = data.statusPageId || null;
        subscriberModel.alertVia = data.alertVia || null;
        subscriberModel.contactEmail = data.contactEmail || null;
        subscriberModel.contactPhone = data.contactPhone || null;
        subscriberModel.countryCode = data.countryCode || null;
        subscriberModel.contactWebhook = data.contactWebhook || null;
        try {
            var subscriber = await subscriberModel.save();
        } catch (error) {
            ErrorService.log('subscriberService.create', error);
            throw error;
        }
        return await _this.findByOne({ _id: subscriber._id });
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var updatedSubscriber = await SubscriberModel.findOneAndUpdate(query, {
                $set: data
            }, {
                new: true
            });
        } catch (error) {
            ErrorService.log('subscriberService.updateOneBy', error);
            throw error;
        }

        return updatedSubscriber;
    },

    deleteBy: async function (query, userId) {
        try {
            var subscriber = await SubscriberModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            }, {
                new: true
            });
            return subscriber;
        } catch (error) {
            ErrorService.log('subscriberService.deleteBy', error);
            throw error;
        }
    },

    findBy: async function (query, skip, limit) {
        try {
            if (!skip) skip = 0;
            if (!limit) limit = 10;
            if (typeof (skip) === 'string') {
                skip = parseInt(skip);
            }

            if (typeof (limit) === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            query.deleted = false;
            var subscribers = await SubscriberModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate('monitorId', 'name')
                .populate('statusPageId', 'title');
            return subscribers;
        } catch (error) {
            ErrorService.log('subscriberService.find', error);
            throw error;
        }
    },

    subscribe: async function (data, monitors) {
        try {
            var _this = this;
            var success = monitors.map(async monitor => {
                let newSubscriber = Object.assign({}, data, { monitorId: monitor });
                let hasSubscribed = await _this.subscriberCheck(newSubscriber);
                if (hasSubscribed) {
                    let error = new Error('You are already subscribed to this monitor.');
                    error.code = 400;
                    ErrorService.log('SubscriberService.subscribe', error);
                    throw error;
                } else {
                    return await _this.create(newSubscriber);
                }
            });
            var subscriber = await Promise.all(success);
            return subscriber;
        } catch (error) {
            ErrorService.log('SubscriberService.subscribe', error);
            throw error;
        }
    },

    subscriberCheck: async function (subscriber) {
        var _this = this;
        var existingSubscriber = null;
        if (subscriber.alertVia === 'sms') {
            existingSubscriber = await _this.findByOne({ monitorId: subscriber.monitorId, contactPhone: subscriber.contactPhone, countryCode: subscriber.countryCode });
        } else if (subscriber.alertVia === 'email') {
            existingSubscriber = await _this.findByOne({ monitorId: subscriber.monitorId, contactEmail: subscriber.contactEmail });
        } else if (subscriber.alertVia === 'webhook') {
            existingSubscriber = await _this.findByOne({ monitorId: subscriber.monitorId, contactWebhook: subscriber.contactWebhook, contactEmail: subscriber.contactEmail });
        }
        return existingSubscriber !== null ? true : false;
    },

    findByOne: async function (query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            var subscriber = await SubscriberModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .populate('monitorId', 'name');

            return subscriber;
        } catch (error) {
            ErrorService.log('SubscriberService.findByOne', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var count = await SubscriberModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('SubscriberService.countBy', error);
            throw error;
        }
    },

    removeBy: async function (query) {
        try {
            await SubscriberModel.deleteMany(query);
            return 'Subscriber(s) removed successfully';
        } catch (error) {
            ErrorService.log('SubscriberService.removeBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function (query) {
        try {
            await SubscriberModel.deleteMany(query);
            return 'Subscriber(s) removed successfully';
        } catch (error) {
            ErrorService.log('SubscriberService.hardDeleteBy', error);
            throw error;
        }
    },

    restoreBy: async function (query) {
        const _this = this;
        query.deleted = true;
        let subscriber = await _this.findBy(query);
        if (subscriber && subscriber.length > 1) {
            const subscribers = await Promise.all(subscriber.map(async (subscriber) => {
                const subscriberId = subscriber._id;
                subscriber = await _this.updateOneBy({ _id: subscriberId, deleted: true }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                return subscriber;
            }));
            return subscribers;
        } else {
            subscriber = subscriber[0];
            if (subscriber) {
                const subscriberId = subscriber._id;
                subscriber = await _this.updateOneBy({ _id: subscriberId, deleted: true }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
            }
            return subscriber;
        }
    }
};

var SubscriberModel = require('../models/subscriber');
var ErrorService = require('./errorService');
