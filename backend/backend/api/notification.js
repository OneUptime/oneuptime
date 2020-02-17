/**
 *
 * Copyright HackerBay, Inc.
 *
 */


const express = require('express');

const router = express.Router();
const NotificationService = require('../services/notificationService');
const {
    isAuthorized
} = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function (req, res) {
    try {
        const subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        const notifications = await NotificationService.findBy({ projectId: { $in: subProjectIds } }, req.query.skip || 0, req.query.limit || 20);
        const count = await NotificationService.countBy({ projectId: { $in: subProjectIds } });
        return sendListResponse(req, res, notifications, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:notificationId/read', getUser, isAuthorized, async function (req, res) {
    try {
        const notificationId = req.params.notificationId;
        const userId = req.user ? req.user.id : null;
        const notification = await NotificationService.updateOneBy({ _id: notificationId},{ read: [userId] });
        if (notification) {
            return sendItemResponse(req, res, notification);
        } else {
            const error = new Error('Notification not found.');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/readAll', getUser, isAuthorized, getSubProjects, async function (req, res) {
    try {
        const subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        const userId = req.user ? req.user.id : null;
        const notifications = await NotificationService.updateManyBy({ projectId: { $in: subProjectIds } }, { read: userId });

        if (notifications.ok === 1 && notifications.n > 0) {
            return sendItemResponse(req, res, { count: notifications.n, read: notifications.nModified });
        } else {
            const error = new Error('No notification found.');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:notificationId', getUser, isAuthorized, async function (req, res) {
    try {
        const notificationId = req.params.notificationId;
        const updateObject = req.body;
        const notification = await NotificationService.updateOneBy({_id:notificationId},updateObject);
        if (notification) {
            return sendItemResponse(req, res, notification);
        } else {
            const error = new Error('Notification not found.');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        const projectId = req.params.projectId;
        const userId = req.user ? req.user.id : null;
        const data = req.body;
        const notification = await NotificationService.create(projectId, data.message, userId, data.icon);
        return sendItemResponse(req, res, notification);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;