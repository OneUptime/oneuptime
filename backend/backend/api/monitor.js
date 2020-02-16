/**
 *
 * Copyright HackerBay, Inc.
 *
 */

let express = require('express');
let UserService = require('../services/userService');
let MonitorService = require('../services/monitorService');
let MonitorLogService = require('../services/monitorLogService');
let NotificationService = require('../services/notificationService');
let RealTimeService = require('../services/realTimeService');
let ScheduleService = require('../services/scheduleService');
let ProbeService = require('../services/probeService');

let router = express.Router();
let isUserAdmin = require('../middlewares/project').isUserAdmin;
let getUser = require('../middlewares/user').getUser;
let getSubProjects = require('../middlewares/subProject').getSubProjects;

const {
    isAuthorized
} = require('../middlewares/authorization');
let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendItemResponse = require('../middlewares/response').sendItemResponse;
let sendListResponse = require('../middlewares/response').sendListResponse;

// Route
// Description: Adding / Updating a new monitor to the project.
// Params:
// Param 1: req.params-> {projectId}; req.body -> {[_id], name, type, data, visibleOnStatusPage} <- Check MonitorMoal for description.
// Returns: response status, error message
router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        let data = req.body;
        let projectId = req.params.projectId;
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

        let monitor = await MonitorService.create(data);
        if (data.callScheduleId) {
            let schedule = await ScheduleService.findOneBy({ _id: data.callScheduleId });
            let monitors = schedule.monitorIds;
            if (monitors.length > 0) {
                monitors.push({ _id: monitor._id, name: monitor.name });
            } else {
                monitors = Array(monitor._id);
            }
            let scheduleData = {
                projectId: projectId,
                monitorIds: monitors
            };
            await ScheduleService.updateOneBy({ _id: data.callScheduleId }, scheduleData);
        }

        let user = await UserService.findOneBy({ _id: req.user.id });

        await NotificationService.create(monitor.projectId._id, `A New Monitor was Created with name ${monitor.name} by ${user.name}`, user._id, 'monitoraddremove');
        await RealTimeService.sendMonitorCreated(monitor);
        return sendItemResponse(req, res, monitor);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:monitorId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        let data = req.body;
        let unsetData;
        if (!data.monitorCategoryId || data.monitorCategoryId === '') {
            unsetData = { monitorCategoryId: '' };
        }
        let monitor = await MonitorService.updateOneBy({ _id: req.params.monitorId }, data, unsetData);
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
        let subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        // Call the MonitorService.
        let monitors = await MonitorService.getMonitorsBySubprojects(subProjectIds, req.query.limit || 0, req.query.skip || 0);
        return sendItemResponse(req, res, monitors);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/monitor', getUser, isAuthorized, getSubProjects, async function (req, res) {
    try {
        let type = req.query.type;
        let subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        let query = type ? { projectId: { $in: subProjectIds }, type } : { projectId: { $in: subProjectIds } };

        let monitors = await MonitorService.findBy(query, req.query.limit || 10, req.query.skip || 0);
        let count = await MonitorService.countBy({ projectId: { $in: subProjectIds } });
        return sendListResponse(req, res, monitors, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/monitor/:monitorId', getUser, isAuthorized, getSubProjects, async function (req, res) {
    try {
        let monitorId = req.params.monitorId;
        let type = req.query.type;
        let subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        let query = type ? { _id: monitorId, projectId: { $in: subProjectIds }, type } : { _id: monitorId, projectId: { $in: subProjectIds } };

        let monitor = await MonitorService.findOneBy(query);
        return sendItemResponse(req, res, monitor);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Get all Monitor logs by monitorId.
router.post('/:projectId/monitorLogs/:monitorId', getUser, isAuthorized, async function (req, res) {
    try {
        const { skip, limit, startDate, endDate, probeValue, incidentId } = req.body;
        let monitorId = req.params.monitorId;
        let query = {};
        if (monitorId && !incidentId) query.monitorId = monitorId;
        if (incidentId) query.incidentIds = incidentId;
        if (probeValue) query.probeId = probeValue;
        if (startDate && endDate) query.createdAt = { $gte: startDate, $lte: endDate };

        // Call the MonitorService.
        let monitorLogs = await MonitorLogService.findBy(query, limit || 10, skip || 0);
        let count = await MonitorLogService.countBy(query);
        return sendListResponse(req, res, monitorLogs, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId/:monitorId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        let monitor = await MonitorService.deleteBy({ _id: req.params.monitorId, projectId: req.params.projectId }, req.user.id);
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
        let monitorId = req.params.monitorId || req.body._id;
        let data = req.body;
        data.monitorId = monitorId;

        let monitor = await MonitorService.findOneBy({ _id: monitorId });

        let validUp = await (monitor && monitor.criteria && monitor.criteria.up ? ProbeService.conditions(data, null, monitor.criteria.up) : false);
        let validDegraded = await (monitor && monitor.criteria && monitor.criteria.degraded ? ProbeService.conditions(data, null, monitor.criteria.degraded) : false);
        let validDown = await (monitor && monitor.criteria && monitor.criteria.down ? ProbeService.conditions(data, null, monitor.criteria.down) : false);

        if (validDown) {
            data.status = 'offline';
        } else if (validDegraded) {
            data.status = 'degraded';
        } else if (validUp) {
            data.status = 'online';
        } else {
            data.status = 'unknown';
        }

        let log = await ProbeService.saveMonitorLog(data);
        return sendItemResponse(req, res, log);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Get all Monitor Logs by monitorId
router.post('/:projectId/monitorLog/:monitorId', getUser, isAuthorized, async function (req, res) {
    try {
        const { startDate, endDate } = req.body;
        let monitorId = req.params.monitorId;
        let monitorLogs = await MonitorService.getMonitorLogs(monitorId, startDate, endDate);
        return sendListResponse(req, res, monitorLogs);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Get all Monitor Statuses by monitorId
router.post('/:projectId/monitorStatuses/:monitorId', getUser, isAuthorized, async function (req, res) {
    try {
        const { startDate, endDate } = req.body;
        let monitorId = req.params.monitorId;
        let monitorStatuses = await MonitorService.getMonitorStatuses(monitorId, startDate, endDate);
        return sendListResponse(req, res, monitorStatuses);
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

let _updateDeviceMonitorPingTime = async function (req, res) {
    try {
        let projectId = req.params.projectId;
        let deviceId = req.params.deviceId;

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

        let monitor = await MonitorService.updateDeviceMonitorPingTime(projectId, deviceId);
        if (monitor) {
            return sendItemResponse(req, res, monitor);
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor not found or is not associated with this project.'
            });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
};

router.post('/:projectId/addseat', getUser, isAuthorized, async function (req, res) {
    try {
        let seatresponse = await MonitorService.addSeat({ _id: req.params.projectId });
        return sendItemResponse(req, res, seatresponse);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
