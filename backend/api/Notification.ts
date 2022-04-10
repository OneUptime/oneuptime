import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';

const router = express.getRouter();
import NotificationService from '../services/notificationService';

import { isAuthorized } from '../middlewares/authorization';
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;
import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'common-server/utils/response';
import Exception from 'common/types/exception/Exception';

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    getSubProjects,
    async function (req, res) {
        try {
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;

            const populateNotification = [
                { path: 'projectId', select: 'name' },
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

            const [notifications, count] = await Promise.all([
                NotificationService.findBy({
                    query: { projectId: { $in: subProjectIds } },
                    skip: req.query['skip'] || 0,
                    limit: req.query['limit'] || 20,
                    populate: populateNotification,
                    select: selectNotification,
                }),
                NotificationService.countBy({
                    projectId: { $in: subProjectIds },
                }),
            ]);
            return sendListResponse(req, res, notifications, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/read',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            // const notificationId = req.params.notificationId;

            const userId = req.user ? req.user.id : null;

            const { notificationIds } = req.body;
            const notifications = [];
            for (const notificationId of notificationIds) {
                const notification = await NotificationService.updateOneBy(
                    { _id: notificationId },
                    { read: [userId] }
                );
                if (notification) {
                    notifications.push(notificationId);
                }
            }

            return sendItemResponse(req, res, notifications);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:notificationId/closed',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const notificationId = req.params.notificationId;

            const userId = req.user ? req.user.id : null;
            const notification = await NotificationService.updateOneBy(
                { _id: notificationId },
                { closed: [userId] }
            );
            if (notification) {
                return sendItemResponse(req, res, notification);
            } else {
                const error = new Error('Notification not found.');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/readAll',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;

            const userId = req.user ? req.user.id : null;
            const notifications = await NotificationService.updateManyBy(
                { projectId: { $in: subProjectIds } },
                { read: userId }
            );

            if (notifications.ok === 1 && notifications.n > 0) {
                return sendItemResponse(req, res, {
                    count: notifications.n,
                    read: notifications.nModified,
                });
            } else {
                const error = new Error('No notification found.');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:notificationId',
    getUser,
    isAuthorized,
    async function (req, res) {
        try {
            const notificationId = req.params.notificationId;
            const updateObject = req.body;
            const notification = await NotificationService.updateOneBy(
                { _id: notificationId },
                updateObject
            );
            if (notification) {
                return sendItemResponse(req, res, notification);
            } else {
                const error = new Error('Notification not found.');

                error.code = 400;
                return sendErrorResponse(req, res, error as Exception);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;

            const userId = req.user ? req.user.id : null;
            const data = req.body;

            const notification = await NotificationService.create(
                projectId,
                data.message,
                userId,
                data.icon
            );
            return sendItemResponse(req, res, notification);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
