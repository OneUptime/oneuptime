/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const ApplicationLogService = require('../services/applicationLogService');
const UserService = require('../services/userService');
const ComponentService = require('../services/componentService');
const NotificationService = require('../services/notificationService');
const RealTimeService = require('../services/realTimeService');

const router = express.Router();
const getUser = require('../middlewares/user').getUser;

const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

// Route
// Description: Adding a new application log to a component.
// Params:
// Param 1: req.params-> {componentId}; req.body -> {[_id], name}
// Returns: response status, error message
router.post('/:componentId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const componentId = req.params.componentId;
        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "values can't be null",
            });
        }
        data.createdById = req.user ? req.user.id : null;
        if (!data.name) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Application Log Name is required.',
            });
        }

        
        data.componentId = componentId;

        const applicationLog = await ApplicationLogService.create(data);
        const component = await ComponentService.findOneBy({ _id: componentId });

        const user = await UserService.findOneBy({ _id: req.user.id });

        await NotificationService.create(
            component.projectId._id,
            `A New Application Log was Created with name ${applicationLog.name} by ${user.name}`,
            user._id,
            'applicationlogaddremove'
        );
        await RealTimeService.sendApplicationLogCreated(applicationLog);
        return sendItemResponse(req, res, applicationLog);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;