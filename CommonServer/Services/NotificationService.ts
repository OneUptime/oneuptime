import NotificationModel from '../Models/notification';
import ObjectID from 'Common/Types/ObjectID';
import RealTimeService from './realTimeService';
import Query from '../Types/DB/Query';

export default class Service {
    async create(
        projectId: ObjectID,
        message: $TSFixMe,
        userId: ObjectID,
        icon: $TSFixMe,
        meta: $TSFixMe
    ): void {
        if (!meta) {
            meta = {};
        }
        const populateNotification: $TSFixMe = [
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

        const selectNotification: $TSFixMe =
            'projectId createdAt createdBy message read closed icon meta deleted deletedAt deletedById';
        let notification = new NotificationModel();

        notification.projectId = projectId;

        notification.message = message;

        notification.icon = icon;

        notification.createdBy = userId;

        notification.meta = meta;
        notification = await notification.save();
        const populatedNotification: $TSFixMe = await this.findOneBy({
            query: { _id: notification._id },
            select: selectNotification,
            populate: populateNotification,
        });

        // run this in the background
        RealTimeService.sendNotification(populatedNotification || notification);

        return populatedNotification || notification;
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        let notification: $TSFixMe = await this.findOneBy({
            query,
            select: 'read closed',
        });

        if (data.read) {
            const read: $TSFixMe = notification.read;
            for (const userId of data.read) {
                read.push(userId);
            }
            data.read = read;
        }
        if (data.closed) {
            const closed: $TSFixMe = notification.closed;
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
    }
}
