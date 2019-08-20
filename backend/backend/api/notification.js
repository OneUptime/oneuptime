/**
 *
 * Copyright HackerBay, Inc.
 *
 */


var express = require('express');

var router = express.Router();
var NotificationService = require('../services/notificationService');
const {
    isAuthorized
} = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendListResponse = require('../middlewares/response').sendListResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;

router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function (req, res) {
    var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
    try{
        var notifications = await NotificationService.findBy({ projectId: { $in: subProjectIds } }, req.query.skip || 0, req.query.limit || 20);
        var count = await NotificationService.countBy({ projectId: { $in: subProjectIds } });
        return sendListResponse(req, res, notifications, count);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:notificationId/read', getUser, isAuthorized, async function (req, res) {
    var notificationId = req.params.notificationId;
    let userId = req.user ? req.user.id : null;
    try{
        let notification = await NotificationService.updateBy({_id: notificationId, read: [userId]});
        if(notification){
            return sendItemResponse(req, res, notification);
        }else{
            var error = new Error('Notification not found.');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:notificationId', getUser, isAuthorized, async function (req, res) {
    var notificationId = req.params.notificationId;
    var updateObject = req.body;
    updateObject._id = notificationId;
    try {
        let notification = await NotificationService.updateBy(updateObject);
        if (notification) {
            return sendItemResponse(req, res, notification);
        } else {
            var error = new Error('Notification not found.');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId', getUser, isAuthorized, async function(req, res){
    var projectId = req.params.projectId;
    let userId = req.user ? req.user.id : null;
    var data = req.body;
    try{
        var notification = await NotificationService.create(projectId, data.message, userId, data.icon);
        return sendItemResponse(req, res, notification);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;