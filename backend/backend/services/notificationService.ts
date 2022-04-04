import NotificationModel from 'common-server/models/notification';
import RealTimeService from '../services/realTimeService';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
import FindOneBy from 'common-server/types/db/FindOneBy';
import FindBy from 'common-server/types/db/FindBy';
import Query from 'common-server/types/db/Query';

export default {
    async findBy({ query, skip, limit, populate, select, sort }: FindBy) {
        query.deleted = false;
        let notificationsQuery = NotificationModel.find(query)
            .lean()
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort);

        notificationsQuery = handleSelect(select, notificationsQuery);
        notificationsQuery = handlePopulate(populate, notificationsQuery);

        const notifications = await notificationsQuery;
        return notifications;
    },

    async countBy(query: Query) {
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
        userId: string,
        icon: $TSFixMe,
        meta: $TSFixMe
    ) {
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
        RealTimeService.sendNotification(populatedNotification || notification);

        return populatedNotification || notification;
    },

    updateManyBy: async function (query: Query, data: $TSFixMe) {
        const notifications = await NotificationModel.updateMany(query, {
            $addToSet: data,
        });
        return notifications;
    },

    updateOneBy: async function (query: Query, data: $TSFixMe) {
        const _this = this;
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
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

    updateBy: async function (query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
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

    hardDeleteBy: async function (query: Query) {
        await NotificationModel.deleteMany(query);
        return 'Notification(s) removed successfully!';
    },

    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        let notificationQuery = NotificationModel.findOne(query)
            .sort(sort)
            .lean();

        notificationQuery = handleSelect(select, notificationQuery);
        notificationQuery = handlePopulate(populate, notificationQuery);

        const notification = await notificationQuery;

        return notification;
    },
};
