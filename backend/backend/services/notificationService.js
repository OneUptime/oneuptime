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

    get: async function (projectId, userId) {
        try {
            var notifications = await NotificationModel.find({ projectId, createdById: { $ne: userId } }).sort({ createdAt: -1 });
        } catch (error) {
            ErrorService.log('NotificationModel.find', error);
            throw error;
        }
        return notifications;
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
        } catch (error) {
            ErrorService.log('notification.save', error);
            throw error;
        }
        try {
            await RealTimeService.sendNotification(notification);
        } catch (error) {
            ErrorService.log('RealTimeService.sendNotification', error);
            throw error;
        }
        return notification;
    },

    updateManyBy: async function (id, data) {
        try {
            var notifications = await NotificationModel.updateMany({ projectId: id }, {
                $addToSet: {
                    read: data
                }
            });
        } catch (error) {
            ErrorService.log('NotificationModel.updateManyBy', error);
            throw error;
        }

        return notifications;
    },

    updateBy: async function (data) {
        let _this = this;
        if (!data._id) {
            try {
                let notification = await _this.create(data.projectId, data.message, data.userId, data.icon);
                return notification;
            } catch (error) {
                ErrorService.log('NotificationService.create', error);
                throw error;
            }
        } else {
            try {
                var notification = await _this.findOneBy({ _id: data._id });
            } catch (error) {
                ErrorService.log('Notification.findOneBy', error);
                throw error;
            }
            let projectId = data.projectId || notification.projectId;
            let createdAt = data.createdAt || notification.createdAt;
            let createdBy = data.createdBy || notification.createdBy;
            let message = data.message || notification.message;
            let read = notification.read;
            let meta = data.meta || notification.meta;
            if (data.read) {
                for (let userId of data.read) {
                    read.push(userId);
                }
            }
            let icon = data.icon || notification.icon;
            try {
                notification = await NotificationModel.findByIdAndUpdate(data._id, {
                    $set: {
                        projectId: projectId,
                        createdAt: createdAt,
                        createdBy: createdBy,
                        message: message,
                        icon: icon,
                        read: read,
                        meta: meta
                    }
                }, {
                    new: true
                });
            } catch (error) {
                ErrorService.log('NotificationModel.findByIdAndUpdate', error);
                throw error;
            }

            return notification;
        }
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
