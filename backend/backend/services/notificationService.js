module.exports = {
    async findBy(query, skip, limit) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 20;

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
            const notifications = await NotificationModel.find(query)
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
            const count = await NotificationModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('notificationService.countBy', error);
            throw error;
        }
    },

    create: async function(projectId, message, userId, icon, meta) {
        try {
            if (!meta) {
                meta = {};
            }
            let notification = new NotificationModel();
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

    updateManyBy: async function(query, data) {
        try {
            const notifications = await NotificationModel.updateMany(query, {
                $addToSet: data,
            });
            return notifications;
        } catch (error) {
            ErrorService.log('notificationService.updateManyBy', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            const _this = this;
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let notification = await _this.findOneBy(query);
            const read = notification.read;
            if (data.read) {
                for (const userId of data.read) {
                    read.push(userId);
                }
            }
            data.read = read;
            notification = await NotificationModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
            return notification;
        } catch (error) {
            ErrorService.log('notificationService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await NotificationModel.updateMany(query, {
                $set: data,
            });
            updatedData = await NotificationModel.find(query).sort({
                createdAt: -1,
            });
            return updatedData;
        } catch (error) {
            ErrorService.log('notificationService.updateMany', error);
            throw error;
        }
    },

    delete: async function(notificationId) {
        try {
            const result = await NotificationModel.findById(
                notificationId
            ).remove();
            return result;
        } catch (error) {
            ErrorService.log('notificationService.delete', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await NotificationModel.deleteMany(query);
            return 'Notification(s) removed successfully!';
        } catch (error) {
            ErrorService.log('notificationService.hardDeleteBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const notification = await NotificationModel.findOne(
                query
            ).populate('projectId', 'name');
            return notification;
        } catch (error) {
            ErrorService.log('notificationService.findOneBy', error);
            throw error;
        }
    },
};

const NotificationModel = require('../models/notification');
const RealTimeService = require('../services/realTimeService');
const ErrorService = require('../services/errorService');
