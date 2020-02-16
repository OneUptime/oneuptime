/**
 *
 * Copyright HackerBay, Inc.
 *
 */


let express = require('express');

let router = express.Router();
let NotificationService = require('../services/notificationService');
const {
    isAuthorized
} = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;
let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendListResponse = require('../middlewares/response').sendListResponse;
let sendItemResponse = require('../middlewares/response').sendItemResponse;

router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function (req, res) {
    try {
        let subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        let notifications = await NotificationService.findBy({ projectId: { $in: subProjectIds } }, req.query.skip || 0, req.query.limit || 20);
        let count = await NotificationService.countBy({ projectId: { $in: subProjectIds } });
        return sendListResponse(req, res, notifications, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:notificationId/read', getUser, isAuthorized, async function (req, res) {
    try {
        let notificationId = req.params.notificationId;
        let userId = req.user ? req.user.id : null;
        let notification = await NotificationService.updateOneBy({ _id: notificationId},{ read: [userId] });
        if (notification) {
            return sendItemResponse(req, res, notification);
        } else {
            let error = new Error('Notification not found.');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/readAll', getUser, isAuthorized, getSubProjects, async function (req, res) {
    try {
        let subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        let userId = req.user ? req.user.id : null;
        let notifications = await NotificationService.updateManyBy({ projectId: { $in: subProjectIds } }, { read: userId });

        if (notifications.ok === 1 && notifications.n > 0) {
            return sendItemResponse(req, res, { count: notifications.n, read: notifications.nModified });
        } else {
            let error = new Error('No notification found.');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:notificationId', getUser, isAuthorized, async function (req, res) {
    try {
        let notificationId = req.params.notificationId;
        let updateObject = req.body;
        let notification = await NotificationService.updateOneBy({_id:notificationId},updateObject);
        if (notification) {
            return sendItemResponse(req, res, notification);
        } else {
            let error = new Error('Notification not found.');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        let projectId = req.params.projectId;
        let userId = req.user ? req.user.id : null;
        let data = req.body;
        let notification = await NotificationService.create(projectId, data.message, userId, data.icon);
        return sendItemResponse(req, res, notification);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;