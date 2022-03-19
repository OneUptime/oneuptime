export default {
    async findBy({ query, skip, limit, populate, select }: $TSFixMe) {
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
        let notificationsQuery = NotificationModel.find(query)
            .lean()
            .limit(limit)
            .skip(skip)
            .sort({ createdAt: -1 });

        notificationsQuery = handleSelect(select, notificationsQuery);
        notificationsQuery = handlePopulate(populate, notificationsQuery);

        const notifications = await notificationsQuery;
        return notifications;
    },

    async countBy(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await NotificationModel.countDocuments(query);
        return count;
    },

    create: async function (
        projectId: $TSFixMe,
        message: $TSFixMe,
        userId: $TSFixMe,
        icon: $TSFixMe,
        meta: $TSFixMe
    ) {
        try {
            if (!meta) {
                meta = {};
            }
            const populateNotification = [
                { path: 'projectId', select: 'name _id' },
                {
                    path: 'meta.incidentId',
                    model: 'Incident',
                    select: '_id idNumber slug',
                },
                {
                    path: 'meta.componentId',
                    model: 'Component',
                    select: '_id slug',
                },
            ];

            const selectNotification =
                'projectId createdAt createdBy message read closed icon meta deleted deletedAt deletedById';
            let notification = new NotificationModel();

            notification.projectId = projectId;

            notification.message = message;

            notification.icon = icon;

            notification.createdBy = userId;

            notification.meta = meta;
            notification = await notification.save();
            const populatedNotification = await this.findOneBy({
                query: { _id: notification._id },
                select: selectNotification,
                populate: populateNotification,
            });

            // run this in the background
            RealTimeService.sendNotification(
                populatedNotification || notification
            );

            return populatedNotification || notification;
        } catch (error) {
            ErrorService.log('notificationService.create', error);
            throw error;
        }
    },

    updateManyBy: async function (query: $TSFixMe, data: $TSFixMe) {
        const notifications = await NotificationModel.updateMany(query, {
            $addToSet: data,
        });
        return notifications;
    },

    updateOneBy: async function (query: $TSFixMe, data: $TSFixMe) {
        const _this = this;
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let notification = await _this.findOneBy({
            query,
            select: 'read closed',
        });

        if (data.read) {
            const read = notification.read;
            for (const userId of data.read) {
                read.push(userId);
            }
            data.read = read;
        }
        if (data.closed) {
            const closed = notification.closed;
            if (data.closed) {
                for (const userId of data.closed) {
                    closed.push(userId);
                }
            }
            data.closed = closed;
        }
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
    },

    updateBy: async function (query: $TSFixMe, data: $TSFixMe) {
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
    },

    delete: async function (notificationId: $TSFixMe) {
        const result = await NotificationModel.findById(
            notificationId
        ).remove();
        return result;
    },

    hardDeleteBy: async function (query: $TSFixMe) {
        await NotificationModel.deleteMany(query);
        return 'Notification(s) removed successfully!';
    },

    findOneBy: async function ({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        let notificationQuery = NotificationModel.findOne(query).lean();

        notificationQuery = handleSelect(select, notificationQuery);
        notificationQuery = handlePopulate(populate, notificationQuery);

        const notification = await notificationQuery;

        return notification;
    },
};

import NotificationModel from '../models/notification';
import RealTimeService from '../services/realTimeService';
import ErrorService from 'common-server/utils/error';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
