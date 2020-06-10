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
const LogService = require('../services/logService');

const router = express.Router();
const getUser = require('../middlewares/user').getUser;
const isApplicationLogValid = require('../middlewares/applicationLog').isApplicationLogValid;

const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
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
    '/:applicationLogId/log',
    isApplicationLogValid,
    async function(req, res) {
        try {
            const data = req.body;
            const applicationLogId = req.params.applicationLogId;
            
            data.applicationLogId = applicationLogId;
    
            const log = await LogService.create(data);
            
            await RealTimeService.sendLogCreated(log);
            return sendItemResponse(req, res, log);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
// Description: Get all Logs by applicationLogId.
router.post(
    '/:applicationLogId/logs',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const {
                skip,
                limit,
                startDate,
                endDate,
            } = req.body;
            const applicationLogId = req.params.applicationLogId;
            const query = {};
            if (applicationLogId) query.applicationLogId = applicationLogId;
            if (startDate && endDate)
                query.createdAt = { $gte: startDate, $lte: endDate };

            // Call the LogService.
            const logs = await LogService.findBy(
                query,
                limit || 10,
                skip || 0
            );
            const count = await LogService.countBy(query);
            return sendListResponse(req, res, logs, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;