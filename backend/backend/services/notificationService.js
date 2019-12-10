module.exports = {
    async findBy(query, skip, limit) {

        if (!skip) skip = 0;

        if (!limit) limit = 20;

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
            var notifications = await NotificationModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 });
        } catch (error) {
            ErrorService.log('NotificationModel.find', error);
            throw error;
        }

        return notifications;
    },

    async countBy(query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var count = await NotificationModel.count(query);
        } catch (error) {
            ErrorService.log('NotificationModel.count', error);
            throw error;
        }

        return count;
    },

    create: async function (projectId, message, userId, icon, meta) {
        if (!meta) {
            meta = {};
        }
        var notification = new NotificationModel();
        notification.projectId = projectId;
        notification.message = message;
        notification.icon = icon;
        notification.createdBy = userId;
        notification.meta = meta;
        try {
            notification = await notification.save();
            await RealTimeService.sendNotification(notification);
        } catch (error) {
            ErrorService.log('Notification.save', error);
            throw error;
        }
        return notification;
    },

    updateManyBy: async function (query, data) {
        try {
            var notifications = await NotificationModel.updateMany(query, {
                $addToSet: data
            });
        } catch (error) {
            ErrorService.log('NotificationModel.updateManyBy', error);
            throw error;
        }

        return notifications;
    },

    updateBy: async function (query, data) {
        let _this = this;
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
            var notification = await _this.findOneBy(query);

            let read = notification.read;
            if (data.read) {
                for (let userId of data.read) {
                    read.push(userId);
                }
            }
            data.read = read;
            notification = await NotificationModel.findOneAndUpdate(query, {
                $set: data
            }, {
                new: true
            });
        } catch (error) {
            ErrorService.log('NotificationModel.findOneAndUpdate', error);
            throw error;
        }

        return notification;
    },

    delete: async function (notificationId) {
        try {
            var result = await NotificationModel.findById(notificationId).remove();
        } catch (error) {
            ErrorService.log('NotificationModel.findById', error);
            throw error;
        }
        return result;

    },

    hardDeleteBy: async function (query) {
        try {
            await NotificationModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('NotificationModel.deleteMany', error);
            throw error;
        }
        return 'Notification(s) removed successfully!';
    },

    findOneBy: async function (query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var notification = await NotificationModel.findOne(query)
                .populate('projectId', 'name');
        } catch (error) {
            ErrorService.log('NotificationModel.findOne', error);
            throw error;
        }
        return notification;
    },

};

var NotificationModel = require('../models/notification');
var RealTimeService = require('../services/realTimeService');
var ErrorService = require('../services/errorService');
