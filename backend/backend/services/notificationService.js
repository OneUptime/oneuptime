module.exports = {
    async findBy(query, skip, limit) {
        try {
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
            var notifications = await NotificationModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 });
            return notifications;
        } catch (error) {
            ErrorService.log('notificationService.findBy', error);
            throw error;
        }
    },

    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }
    
            query.deleted = false;
            var count = await NotificationModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('notificationService.countBy', error);
            throw error;
        }
    },

    create: async function (projectId, message, userId, icon, meta) {
        try {
            if (!meta) {
                meta = {};
            }
            var notification = new NotificationModel();
            notification.projectId = projectId;
            notification.message = message;
            notification.icon = icon;
            notification.createdBy = userId;
            notification.meta = meta;
            notification = await notification.save();
            await RealTimeService.sendNotification(notification);
            return notification;
        } catch (error) {
            ErrorService.log('notificationService.create', error);
            throw error;
        }
    },

    updateManyBy: async function (query, data) {
        try {
            var notifications = await NotificationModel.updateMany(query, {
                $addToSet: data
            });
            return notifications;
        } catch (error) {
            ErrorService.log('notificationService.updateManyBy', error);
            throw error;
        }
    },

    updateBy: async function (data) {
        try {
            let _this = this;
            if (!data._id) {
                let notification = await _this.create(data.projectId, data.message, data.userId, data.icon);
                return notification;
            } else {
                var notification = await _this.findOneBy({ _id: data._id });

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
    
                return notification;
            }
        } catch (error) {
            ErrorService.log('notificationService.updateBy', error);
            throw error;
        }
    },

    delete: async function (notificationId) {
        try {
            var result = await NotificationModel.findById(notificationId).remove();
            return result;
        } catch (error) {
            ErrorService.log('notificationService.delete', error);
            throw error;
        }

    },

    hardDeleteBy: async function (query) {
        try {
            await NotificationModel.deleteMany(query);
            return 'Notification(s) removed successfully!';
        } catch (error) {
            ErrorService.log('notificationService.hardDeleteBy', error);
            throw error;
        }
    },

    findOneBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }
    
            query.deleted = false;
            var notification = await NotificationModel.findOne(query)
                .populate('projectId', 'name');
            return notification;
        } catch (error) {
            ErrorService.log('notificationService.findOneBy', error);
            throw error;
        }
    },

};

var NotificationModel = require('../models/notification');
var RealTimeService = require('../services/realTimeService');
var ErrorService = require('../services/errorService');
