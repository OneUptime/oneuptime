import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';

const router: ExpressRouter = Express.getRouter();
import NotificationService from '../services/notificationService';

import { isAuthorized } from '../middlewares/authorization';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const getSubProjects: $TSFixMe =
    require('../middlewares/subProject').getSubProjects;
import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => {
                      return project._id;
                  })
                : null;

            const populateNotification: $TSFixMe = [
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

            const selectNotification: $TSFixMe =
                'projectId createdAt createdBy message read closed icon meta deleted deletedAt deletedById';

            const [notifications, count]: $TSFixMe = await Promise.all([
                NotificationService.findBy({
                    query: { projectId: { $in: subProjectIds } },
                    skip: req.query.skip || 0,
                    limit: req.query.limit || 20,
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
            // Const notificationId: $TSFixMe = req.params['notificationId'];

            const userId: $TSFixMe = req.user ? req.user.id : null;

            const { notificationIds }: $TSFixMe = req.body;
            const notifications: $TSFixMe = [];
            for (const notificationId of notificationIds) {
                const notification: $TSFixMe =
                    await NotificationService.updateOneBy(
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
            const notificationId: $TSFixMe = req.params.notificationId;

            const userId: $TSFixMe = req.user ? req.user.id : null;
            const notification: $TSFixMe =
                await NotificationService.updateOneBy(
                    { _id: notificationId },
                    { closed: [userId] }
                );
            if (notification) {
                return sendItemResponse(req, res, notification);
            }
            const error: $TSFixMe = new Error('Notification not found.');

            error.code = 400;
            return sendErrorResponse(req, res, error as Exception);
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
            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => {
                      return project._id;
                  })
                : null;

            const userId: $TSFixMe = req.user ? req.user.id : null;
            const notifications: $TSFixMe =
                await NotificationService.updateManyBy(
                    { projectId: { $in: subProjectIds } },
                    { read: userId }
                );

            if (notifications.ok === 1 && notifications.n > 0) {
                return sendItemResponse(req, res, {
                    count: notifications.n,
                    read: notifications.nModified,
                });
            }
            const error: $TSFixMe = new Error('No notification found.');

            error.code = 400;
            return sendErrorResponse(req, res, error as Exception);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:notificationId',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const notificationId: $TSFixMe = req.params.notificationId;
            const updateObject: $TSFixMe = req.body;
            const notification: $TSFixMe =
                await NotificationService.updateOneBy(
                    { _id: notificationId },
                    updateObject
                );
            if (notification) {
                return sendItemResponse(req, res, notification);
            }
            const error: $TSFixMe = new Error('Notification not found.');

            error.code = 400;
            return sendErrorResponse(req, res, error as Exception);
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
            const projectId: $TSFixMe = req.params.projectId;

            const userId: $TSFixMe = req.user ? req.user.id : null;
            const data: $TSFixMe = req.body;

            const notification: $TSFixMe = await NotificationService.create(
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
