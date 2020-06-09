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
const ContentLogService = require('../services/contentLogService');

const router = express.Router();
const getUser = require('../middlewares/user').getUser;
const isKeyMappedToId = require('../middlewares/applicationLog').isKeyMappedToId;

const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const isUserAdmin = require('../middlewares/project').isUserAdmin;


// Route
// Description: Adding a new application log to a component.
// Params:
// Param 1: req.params-> {componentId}; req.body -> {[_id], name}
// Returns: response status, error message
router.post('/:componentId', getUser, isAuthorized, isUserAdmin, async function(
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

// Description: Get all Application Logs by componentId.
router.get('/:componentId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const componentId = req.params.componentId;
        if (!componentId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "Component ID can't be null",
            });
        }
        const applicationLogs = await ApplicationLogService.getApplicationLogsByComponentId(
            componentId,
            req.query.limit || 0,
            req.query.skip || 0
        )
        return sendItemResponse(req, res, applicationLogs);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Description: Delete an Application Log by applicationLogId and componentId.
router.delete(
    '/:componentId/:applicationLogId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            const applicationLog = await ApplicationLogService.deleteBy(
                { _id: req.params.applicationLogId, componentId: req.params.componentId },
                req.user.id
            );
            if (applicationLog) {
                return sendItemResponse(req, res, applicationLog);
            } else {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Application Log not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/:applicationLogId/log-content',
    isKeyMappedToId,
    async function(req, res) {
        try {
            const data = req.body;
            
            data.applicationLogId = applicationLogId;
    
            const contentLog = await ContentLogService.create(data);
            const applicationLog = await ApplicationLogService.findOneBy({ _id: contentLog.applicationLogId._id })
            const component = await ComponentService.findOneBy({ _id: applicationLog.componentId._id });
    
            
            await NotificationService.create(
                component.projectId._id,
                `A New Content Log was Created under Application Log with name ${applicationLog.name}`,
                contentLog.user,
                'contentlogaddremove'
            );
            await RealTimeService.sendContentLogCreated(contentLog);
            return sendItemResponse(req, res, contentLog);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
// Description: Get all Content Logs by applicationLogId.
router.get('/:applicationLogId/log-content', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const applicationLogId = req.params.applicationLogId;
        if (!applicationLogId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "Application Log ID can't be null",
            });
        }
        const contentLogs = await ContentLogService.getContentLogsApplicationLogId(
            applicationLogId,
            req.query.limit || 0,
            req.query.skip || 0
        )
        return sendItemResponse(req, res, contentLogs);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;