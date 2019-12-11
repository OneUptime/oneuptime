/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var express = require('express');
var MonitorService = require('../services/monitorService');
var NotificationService = require('../services/notificationService');
var RealTimeService = require('../services/realTimeService');
var ScheduleService = require('../services/scheduleService');
var ProbeService = require('../services/probeService');

var router = express.Router();
var isUserAdmin = require('../middlewares/project').isUserAdmin;
var getUser = require('../middlewares/user').getUser;
var getSubProjects = require('../middlewares/subProject').getSubProjects;

const {
    isAuthorized
} = require('../middlewares/authorization');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;
var sendListResponse = require('../middlewares/response').sendListResponse;
var sendEmptyResponse = require('../middlewares/response').sendEmptyResponse;

// Route
// Description: Adding / Updating a new monitor to the project.
// Params:
// Param 1: req.params-> {projectId}; req.body -> {[_id], name, type, data, visibleOnStatusPage} <- Check MonitorMoal for description.
// Returns: response status, error message
router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        var data = req.body;
        var projectId = req.params.projectId;
        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'values can\'t be null'
            });
        }
        data.createdById = req.user ? req.user.id : null;

        if (data.monitorCategoryId && typeof data.monitorCategoryId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Category ID is not of string type.'
            });
        }
        if (!data.name) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Name is required.'
            });
        }

        if (typeof data.name !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Name is not of type string.'
            });
        }

        if (!data.type) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Type is required.'
            });
        }

        if (typeof data.type !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor type should be of type string.'
            });
        }

        if (data.type !== 'url' && data.type !== 'device' && data.type !== 'manual' && data.type !== 'api' && data.type !== 'server-monitor' && data.type !== 'script') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor type should be url, manual, device or script.'
            });
        }
        if (!data.data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor data is required.'
            });
        }

        if (typeof data.data !== 'object') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Data should be of type object.'
            });
        }

        if (data.type === 'url') {
            if (!data.data.url) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Monitor data should have a `url` property of type string.'
                });
            }

            if ((data.type === 'url' || data.type === 'manual') && typeof data.data.url !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Monitor data should have a `url` property of type string.'
                });
            }
        }

        if (data.type === 'device') {
            if (data.type === 'deviceId' && !data.data.deviceId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Monitor data should have a `url` property of type string.'
                });
            }

            if (data.type === 'deviceId' && typeof data.data.deviceId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Monitor data should have a `Device ID` property of type string.'
                });
            }
        }

        if (data.type === 'script') {
            if (!data.data.script) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Monitor data should have a `script` property of type string.'
                });
            }
        }
        data.projectId = projectId;
        var monitor = await MonitorService.create(data);
        if (data.callScheduleId) {
            var schedule = await ScheduleService.findOneBy({ _id: data.callScheduleId });
            var monitors = schedule.monitorIds;
            if (monitors.length > 0) {
                monitors.push({ _id: monitor[0]._id, name: monitor[0].name });
            } else {
                monitors = Array(monitor[0]._id);
            }
            var scheduleData = {
                projectId: projectId,
                monitorIds: monitors
            };
            await ScheduleService.updateBy({_id: data.callScheduleId},scheduleData);
        }
        await NotificationService.create(monitor.projectId, `A New Monitor was Created with name ${monitor.name} by ${req.user.name}`, req.user.id, 'monitoraddremove');
        await RealTimeService.sendMonitorCreated(monitor);
        return sendItemResponse(req, res, monitor);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:monitorId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        var data = req.body;
        var monitor = await MonitorService.updateBy({ _id: req.params.monitorId }, data);
        if (monitor) {
            return sendItemResponse(req, res, monitor);
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor not found.'
            });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Get all Monitors by projectId.
router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function (req, res) {
    try {
        var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        // Call the MonitorService.
        var monitors = await MonitorService.getMonitors(subProjectIds, req.query.skip || 0, req.query.limit || 0);
        return sendItemResponse(req, res, monitors);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/monitor', getUser, isAuthorized, async function (req, res) {
    try {
        var projectId = req.params.projectId;
        var type = req.query.type;
        var query = type ? { projectId, type } : { projectId };
        var monitors = await MonitorService.findBy(query, req.query.limit || 10, req.query.skip || 0);
        var count = await MonitorService.countBy({ projectId });
        return sendListResponse(req, res, monitors, count); // frontend expects sendListResponse
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/monitor/:monitorId', getUser, isAuthorized, async function (req, res) {
    try {
        var _id = req.params.monitorId;
        var projectId = req.params.projectId;
        var type = req.query.type;
        var query = type ? { _id, projectId, type } : { _id, projectId };
        // Call the MonitorService.
        var monitor = await MonitorService.findOneBy(query);
        return sendItemResponse(req, res, monitor);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId/:monitorId', getUser, isAuthorized, isUserAdmin, async function (req, res) {

    try {
        var monitor = await MonitorService.deleteBy({ _id: req.params.monitorId, projectId: req.params.projectId }, req.user.id);
        if (monitor) {
            return sendItemResponse(req, res, monitor);
        }
        else {
            return sendErrorResponse(req, res, { message: 'Monitor not found' });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Adding / Updating a new monitor log
// Params:
// Param 1: req.params-> {projectId, monitorId}; req.body -> {[_id], data} <- Check MonitorLogModel for description.
// Returns: response status, error message
router.post('/:projectId/log/:monitorId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        var monitorId = req.params.monitorId || req.body._id;
        var data = {
            monitorId,
            data: req.body.data
        };
        var monitor = await MonitorService.findOneBy({ _id: monitorId });

        let validUp = await (monitor && monitor.criteria && monitor.criteria.up ? ProbeService.conditions(data.data, null, monitor.criteria.up) : false);
        let validDegraded = await (monitor && monitor.criteria && monitor.criteria.degraded ? ProbeService.conditions(data.data, null, monitor.criteria.degraded) : false);
        let validDown = await (monitor && monitor.criteria && monitor.criteria.down ? ProbeService.conditions(data.data, null, monitor.criteria.down) : false);

        if (validDown) {
            data.status = 'offline';
        } else if (validDegraded) {
            data.status = 'degraded';
        } else if (validUp) {
            data.status = 'online';
        } else {
            data.status = 'unknown';
        }

        let log = await ProbeService.setTime(data);
        return sendItemResponse(req, res, log);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Get all Monitor Logs by monitorId
router.get('/:projectId/log/:monitorId', getUser, isAuthorized, async function (req, res) {
    try {
        const { startDate, endDate } = req.query;
        var monitorId = req.params.monitorId;
        var monitorLogs = await MonitorService.getMonitorLogs(monitorId, startDate, endDate);
        return sendListResponse(req, res, monitorLogs);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/inbound/:deviceId', getUser, isAuthorized, async function (req, res) {
    return await _updateDeviceMonitorPingTime(req, res);
});

router.get('/:projectId/inbound/:deviceId', getUser, isAuthorized, async function (req, res) {
    return await _updateDeviceMonitorPingTime(req, res);
});

var _updateDeviceMonitorPingTime = async function (req, res) {
    var projectId = req.params.projectId;
    var deviceId = req.params.deviceId;

    if (!projectId) {
        return sendErrorResponse(req, res, {
            code: 404,
            message: 'Missing Project ID'
        });
    }

    if (!deviceId) {
        return sendErrorResponse(req, res, {
            code: 404,
            message: 'Missing Device ID'
        });
    }

    var monitor = await MonitorService.updateDeviceMonitorPingTime(projectId, deviceId);
    if (monitor) {
        return sendEmptyResponse(req, res);
    } else {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Monitor not found or is not associated with this project.'
        });
    }

};

router.post('/:projectId/addseat', getUser, isAuthorized, async function (req, res) {
    try {
        var seatresponse = await MonitorService.addSeat({ _id: req.params.projectId });
        return sendItemResponse(req, res, seatresponse);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
