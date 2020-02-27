module.exports = {
    create: async function(data) {
        try {
            const subscriberAlertModel = new SubscriberAlertModel();
            subscriberAlertModel.projectId = data.projectId || null;
            subscriberAlertModel.subscriberId = data.subscriberId || null;
            subscriberAlertModel.incidentId = data.incidentId || null;
            subscriberAlertModel.alertVia = data.alertVia || null;
            subscriberAlertModel.alertStatus = data.alertStatus || null;
            if (data.error) {
                subscriberAlertModel.error = data.error;
                subscriberAlertModel.errorMessage = data.errorMessage;
            }
            const subscriberAlert = await subscriberAlertModel.save();
            return subscriberAlert;
        } catch (error) {
            ErrorService.log('SubscriberAlertService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            //find and update
            const subscriberAlert = await SubscriberAlertModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
            return subscriberAlert;
        } catch (error) {
            ErrorService.log('SubscriberAlertService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await SubscriberAlertModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('SubscriberAlertService.updateMany', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            const subscriberAlert = await SubscriberAlertModel.findOneAndUpdate(
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
            return subscriberAlert;
        } catch (error) {
            ErrorService.log('SubscriberAlertService.deleteBy', error);
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
            const subscriberAlerts = await SubscriberAlertModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate(
                    'subscriberId',
                    'name contactEmail contactPhone contactWebhook'
                )
                .populate('incidentId', 'name');
            return subscriberAlerts;
        } catch (error) {
            ErrorService.log('SubscriberAlertService.findBy', error);
            throw error;
        }
    },

    findByOne: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const subscriberAlert = await SubscriberAlertModel.find(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .populate('subscriberId', 'name')
                .populate('incidentId', 'name');
            return subscriberAlert;
        } catch (error) {
            ErrorService.log('SubscriberAlertService.findByOne', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const count = await SubscriberAlertModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('SubscriberAlertService.countBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await SubscriberAlertModel.deleteMany(query);
            return 'Subscriber Alert(s) removed successfully';
        } catch (error) {
            ErrorService.log('SubscriberAlertService.hardDeleteBy', error);
            throw error;
        }
    },
};

const SubscriberAlertModel = require('../models/subscriberAlert');
const ErrorService = require('./errorService');
