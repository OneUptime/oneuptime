import express from 'express'

const router = express.Router();
import NotificationService from '../services/notificationService'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/authorization"' has no exp... Remove this comment to see the full error message
import { isAuthorized } from '../middlewares/authorization'
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function(
    req,
    res
) {
    try {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
        const subProjectIds = req.user.subProjects
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
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
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/read', getUser, isAuthorized, async function(req, res) {
    try {
        // const notificationId = req.params.notificationId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
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
        return sendErrorResponse(req, res, error);
    }
});

router.put(
    '/:projectId/:notificationId/closed',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const notificationId = req.params.notificationId;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
            const userId = req.user ? req.user.id : null;
            const notification = await NotificationService.updateOneBy(
                { _id: notificationId },
                { closed: [userId] }
            );
            if (notification) {
                return sendItemResponse(req, res, notification);
            } else {
                const error = new Error('Notification not found.');
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
                error.code = 400;
                return sendErrorResponse(req, res, error);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put(
    '/:projectId/readAll',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
            const subProjectIds = req.user.subProjects
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
                error.code = 400;
                return sendErrorResponse(req, res, error);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put('/:projectId/:notificationId', getUser, isAuthorized, async function(
    req,
    res
) {
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const projectId = req.params.projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
        const userId = req.user ? req.user.id : null;
        const data = req.body;
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 4.
        const notification = await NotificationService.create(
            projectId,
            data.message,
            userId,
            data.icon
        );
        return sendItemResponse(req, res, notification);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
