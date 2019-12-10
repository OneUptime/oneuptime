module.exports = {
    create: async function (data) {
        var subscriberAlertModel = new SubscriberAlertModel();
        subscriberAlertModel.projectId = data.projectId || null;
        subscriberAlertModel.subscriberId = data.subscriberId || null;
        subscriberAlertModel.incidentId = data.incidentId || null;
        subscriberAlertModel.alertVia = data.alertVia || null;
        subscriberAlertModel.alertStatus = data.alertStatus || null;
        try {
            var subscriberAlert = await subscriberAlertModel.save();
        } catch (error) {
            ErrorService.log('subscriberAlertModel.save', error);
            throw error;
        }
        return subscriberAlert;
    },

    updateBy: async function (query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
            //find and update
            var subscriberAlert = await SubscriberAlertModel.findOneAndUpdate(query, {
                $set: data
            }, {
                new: true
            });
        } catch (error) {
            ErrorService.log('SubscriberAlertModel.findOneAndUpdate', error);
            throw error;
        }
        return subscriberAlert;
    },

    deleteBy: async function (query, userId) {
        try {
            var subscriberAlert = await SubscriberAlertModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            }, {
                new: true
            });
        } catch (error) {
            ErrorService.log('SubscriberAlertModel.findOneAndUpdate', error);
            throw error;
        }
        return subscriberAlert;
    },

    findBy: async function (query, skip, limit) {
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
        try {
            var subscriberAlerts = await SubscriberAlertModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate('subscriberId', 'name contactEmail contactPhone contactWebhook')
                .populate('incidentId', 'name');
        } catch (error) {
            ErrorService.log('SubscriberAlertModel.find', error);
            throw error;
        }

        return subscriberAlerts;
    },

    findByOne: async function (query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var subscriberAlert = await SubscriberAlertModel.find(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .populate('subscriberId', 'name')
                .populate('incidentId', 'name');
        } catch (error) {
            ErrorService.log('SubscriberAlertModel.find', error);
            throw error;
        }
        return subscriberAlert;
    },

    countBy: async function (query) {

        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var count = await SubscriberAlertModel.count(query);
        } catch (error) {
            ErrorService.log('SubscriberAlertModel.count', error);
            throw error;
        }
        return count;

    },

    hardDeleteBy: async function (query) {
        try {
            await SubscriberAlertModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('SubscriberAlertModel.deleteMany', error);
            throw error;
        }
        return 'Subscriber Alert(s) removed successfully';
    },
};

var SubscriberAlertModel = require('../models/subscriberAlert');
var ErrorService = require('./errorService');

