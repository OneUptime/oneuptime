/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const axios = require('axios');
const UserService = require('../services/userService');
const MonitorService = require('../services/monitorService');
const MonitorLogService = require('../services/monitorLogService');
const LighthouseLogService = require('../services/lighthouseLogService');
const NotificationService = require('../services/notificationService');
const RealTimeService = require('../services/realTimeService');
const ScheduleService = require('../services/scheduleService');
const ProbeService = require('../services/probeService');
const Api = require('../utils/api');

const router = express.Router();
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const multer = require('multer');
const storage = require('../middlewares/upload');
const https = require('https');
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

// Route
// Description: Adding / Updating a new monitor to the project.
// Params:
// Param 1: req.params-> {projectId}; req.body -> {[_id], name, type, data, visibleOnStatusPage} <- Check MonitorMoal for description.
// Returns: response status, error message
router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const projectId = req.params.projectId;

        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "values can't be null",
            });
        }
        data.createdById = req.user ? req.user.id : null;

        /* if (!data.componentId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Component ID is required.',
            });
        } */

        if (
            data.resourceCategory &&
            typeof data.resourceCategory !== 'string'
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Resource Category ID is not of string type.',
            });
        }
        if (!data.name) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Name is required.',
            });
        }

        if (typeof data.name !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Name is not of type string.',
            });
        }

        if (!data.type) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Type is required.',
            });
        }

        if (typeof data.type !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor type should be of type string.',
            });
        }

        if (
            data.type !== 'url' &&
            data.type !== 'manual' &&
            data.type !== 'api' &&
            data.type !== 'server-monitor' &&
            data.type !== 'script' &&
            data.type !== 'incomingHttpRequest' &&
            data.type !== 'kubernetes' &&
            data.type !== 'ip'
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message:
                    'Monitor type should be url, manual, device, script, api, server-monitor, incomingHttpRequest, kubernetes or ip.',
            });
        }
        if (!data.data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor data is required.',
            });
        }

        if (typeof data.data !== 'object') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Data should be of type object.',
            });
        }

        if (data.type === 'url' || data.type === 'api') {
            if (!data.data.url) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Monitor data should have a `url` property of type string.',
                });
            }

            if (
                (data.type === 'url' || data.type === 'manual') &&
                typeof data.data.url !== 'string'
            ) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Monitor data should have a `url` property of type string.',
                });
            }

            if (data.type === 'api') {
                try {
                    const headers = await Api.headers(
                        data.headers,
                        data.bodyType
                    );

                    const body = await Api.body(
                        data.text && data.text.length
                            ? data.text
                            : data.formData,
                        data.text && data.text.length ? 'text' : 'formData'
                    );
                    const payload = {
                        method: data.method,
                        url: data.data.url,
                        httpsAgent,
                    };
                    if (headers && Object.keys(headers).length) {
                        payload.headers = headers;
                    }
                    if (body && Object.keys(body).length) {
                        payload.data = body;
                    }
                    const apiResponse = await axios(payload);
                    const headerContentType =
                        apiResponse.headers['content-type'];
                    if (/text\/html/.test(headerContentType)) {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message:
                                'API Monitor URL should not be a HTML page.',
                        });
                    }
                } catch (err) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            (err.response && err.response.statusText) ||
                            err.message ||
                            'Monitor url did not return a valid response.',
                    });
                }
            }
        }

        if (data.type === 'server-monitor') {
            if (
                data.agentlessConfig &&
                data.agentlessConfig.authentication === 'identityFile' &&
                !data.agentlessConfig.identityFile
            ) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Monitor should have an `Identity File` property of type string.',
                });
            }
        }

        if (
            data.type === 'kubernetes' &&
            (!data.kubernetesConfig || !data.kubernetesConfig.trim())
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor should have a configuration file',
            });
        }

        if (data.type === 'script') {
            if (!data.data.script) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Monitor data should have a `script` property of type string.',
                });
            }
        }
        if (data.type === 'ip') {
            if (!data.data.IPAddress) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Monitor data should have a `IPAddress` property of type string.',
                });
            }
        }
        data.projectId = projectId;
        const monitor = await MonitorService.create(data);
        if (data.callScheduleIds && data.callScheduleIds.length) {
            await ScheduleService.addMonitorToSchedules(
                data.callScheduleIds,
                monitor._id
            );
        }

        const user = await UserService.findOneBy({ _id: req.user.id });

        await NotificationService.create(
            monitor.projectId._id,
            `A New Monitor was Created with name ${monitor.name} by ${user.name}`,
            user._id,
            'monitoraddremove'
        );

        await RealTimeService.sendMonitorCreated(monitor);

        return sendItemResponse(req, res, monitor);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/identityFile', async function(req, res) {
    try {
        const upload = multer({
            storage,
        }).fields([
            {
                name: 'identityFile',
                maxCount: 1,
            },
        ]);
        upload(req, res, async function(error) {
            let identityFile;
            if (error) {
                return sendErrorResponse(req, res, error);
            }
            if (
                req.files &&
                req.files.identityFile &&
                req.files.identityFile[0].filename
            ) {
                identityFile = req.files.identityFile[0].filename;
            }
            return sendItemResponse(req, res, { identityFile });
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/configurationFile', async function(req, res) {
    try {
        const upload = multer({
            storage,
        }).fields([
            {
                name: 'configurationFile',
                maxCount: 1,
            },
        ]);
        upload(req, res, async function(error) {
            let configurationFile;
            if (error) {
                return sendErrorResponse(req, res, error);
            }
            if (
                req.files &&
                req.files.configurationFile &&
                req.files.configurationFile[0].filename
            ) {
                configurationFile = req.files.configurationFile[0].filename;
            }
            return sendItemResponse(req, res, { configurationFile });
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put(
    '/:projectId/:monitorId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            const data = req.body;
            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "values can't be null",
                });
            }
            if (data.type && data.type === 'api') {
                try {
                    const headers = await Api.headers(
                        data.headers,
                        data.bodyType
                    );
                    const body = await Api.body(
                        data.text && data.text.length
                            ? data.text
                            : data.formData,
                        data.text && data.text.length ? 'text' : 'formData'
                    );
                    const payload = {
                        method: data.method,
                        url: data.data.url,
                        httpsAgent,
                    };
                    if (headers && Object.keys(headers).length) {
                        payload.headers = headers;
                    }
                    if (body && Object.keys(body).length) {
                        payload.data = body;
                    }
                    const apiResponse = await axios(payload);
                    const headerContentType =
                        apiResponse.headers['content-type'];
                    if (/text\/html/.test(headerContentType)) {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message:
                                'API Monitor URL should not be a HTML page.',
                        });
                    }
                } catch (err) {
                    // skip errors with a response, reject those without
                    if (!err.response) {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message:
                                (err.response && err.response.statusText) ||
                                'Monitor url did not return a valid response.',
                        });
                    }
                }
            }

            await ScheduleService.deleteMonitor(req.params.monitorId);
            if (data.callScheduleIds && data.callScheduleIds.length) {
                await ScheduleService.addMonitorToSchedules(
                    data.callScheduleIds,
                    req.params.monitorId
                );
            }

            let unsetData;
            if (!data.resourceCategory || data.resourceCategory === '') {
                unsetData = { resourceCategory: '' };
            }
            const monitor = await MonitorService.updateOneBy(
                { _id: req.params.monitorId },
                data,
                unsetData
            );

            if (monitor) {
                return sendItemResponse(req, res, monitor);
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Monitor not found.',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Get all Monitors by projectId.
router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function(
    req,
    res
) {
    try {
        const subProjectIds = req.user.subProjects
            ? req.user.subProjects.map(project => project._id)
            : null;
        // Call the MonitorService.
        const monitors = await MonitorService.getMonitorsBySubprojects(
            subProjectIds,
            req.query.limit || 0,
            req.query.skip || 0
        );
        return sendItemResponse(req, res, monitors);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/monitor',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const type = req.query.type;
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;
            const query = type
                ? { projectId: { $in: subProjectIds }, type }
                : { projectId: { $in: subProjectIds } };

            const monitors = await MonitorService.findBy(
                query,
                req.query.limit || 10,
                req.query.skip || 0
            );
            const count = await MonitorService.countBy({
                projectId: { $in: subProjectIds },
            });
            return sendListResponse(req, res, monitors, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/monitor/:monitorId',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const monitorId = req.params.monitorId;
            const type = req.query.type;
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;
            const query = type
                ? { _id: monitorId, projectId: { $in: subProjectIds }, type }
                : { _id: monitorId, projectId: { $in: subProjectIds } };

            const monitor = await MonitorService.findOneBy(query);
            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Get all Monitor logs by monitorId.
router.post(
    '/:projectId/monitorLogs/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const {
                skip,
                limit,
                startDate,
                endDate,
                probeValue,
                incidentId,
                type,
            } = req.body;
            const monitorId = req.params.monitorId;
            const query = {};
            if (monitorId && !incidentId) query.monitorId = monitorId;
            if (incidentId) query.incidentIds = incidentId;
            if (probeValue) query.probeId = probeValue;
            if (type === 'incomingHttpRequest') query.probeId = null;
            if (startDate && endDate)
                query.createdAt = { $gte: startDate, $lte: endDate };

            // Call the MonitorService.
            const monitorLogs = await MonitorLogService.findBy(
                query,
                limit || 10,
                skip || 0
            );
            const count = await MonitorLogService.countBy(query);
            return sendListResponse(req, res, monitorLogs, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/:monitorId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            const monitor = await MonitorService.deleteBy(
                { _id: req.params.monitorId, projectId: req.params.projectId },
                req.user.id
            );
            if (monitor) {
                return sendItemResponse(req, res, monitor);
            } else {
                return sendErrorResponse(req, res, {
                    message: 'Monitor not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Adding / Updating a new monitor log
// Params:
// Param 1: req.params-> {projectId, monitorId}; req.body -> {[_id], data} <- Check MonitorLogModel for description.
// Returns: response status, error message
router.post(
    '/:projectId/log/:monitorId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            const monitorId = req.params.monitorId || req.body._id;
            const data = req.body;
            data.monitorId = monitorId;

            const monitor = await MonitorService.findOneBy({ _id: monitorId });

            const {
                stat: validUp,
                successReasons: upSuccessReasons,
                failedReasons: upFailedReasons,
            } = await (monitor && monitor.criteria && monitor.criteria.up
                ? ProbeService.conditions(
                      monitor.type,
                      monitor.criteria.up,
                      data
                  )
                : { stat: false, failedReasons: [], successReasons: [] });
            const {
                stat: validDegraded,
                successReasons: degradedSuccessReasons,
                failedReasons: degradedFailedReasons,
            } = await (monitor && monitor.criteria && monitor.criteria.degraded
                ? ProbeService.conditions(
                      monitor.type,
                      monitor.criteria.degraded,
                      data
                  )
                : { stat: false, failedReasons: [], successReasons: [] });
            const {
                stat: validDown,
                successReasons: downSuccessReasons,
                failedReasons: downFailedReasons,
            } = await (monitor && monitor.criteria && monitor.criteria.down
                ? ProbeService.conditions(
                      monitor.type,
                      monitor.criteria.down,
                      data
                  )
                : { stat: false, failedReasons: [], successReasons: [] });

            if (validUp) {
                data.status = 'online';
                data.reason = upSuccessReasons;
            } else if (validDegraded) {
                data.status = 'degraded';
                data.reason = [...degradedSuccessReasons, ...upFailedReasons];
            } else if (validDown) {
                data.status = 'offline';
                data.reason = [
                    ...downSuccessReasons,
                    ...degradedFailedReasons,
                    ...upFailedReasons,
                ];
            } else {
                data.status = 'offline';
                data.reason = [
                    ...downFailedReasons,
                    ...degradedFailedReasons,
                    ...upFailedReasons,
                ];
            }
            const index = data.reason.indexOf('Request Timed out');
            if (index > -1) {
                data.reason = data.reason.filter(
                    item => !item.includes('Response Time is')
                );
            }
            data.reason = data.reason.filter(
                (item, pos, self) => self.indexOf(item) === pos
            );
            const log = await ProbeService.saveMonitorLog(data);

            return sendItemResponse(req, res, log);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Get all Monitor Logs by monitorId
router.post(
    '/:projectId/monitorLog/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { startDate, endDate } = req.body;
            const monitorId = req.params.monitorId;
            const monitorLogs = await MonitorService.getMonitorLogs(
                monitorId,
                startDate,
                endDate
            );
            return sendListResponse(req, res, monitorLogs);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Get all Monitor Statuses by monitorId
router.post(
    '/:projectId/monitorStatuses/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { startDate, endDate } = req.body;
            const monitorId = req.params.monitorId;
            const monitorStatuses = await MonitorService.getMonitorStatuses(
                monitorId,
                startDate,
                endDate
            );
            return sendListResponse(req, res, monitorStatuses);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Get all Lighthouse Logs by monitorId
router.get(
    '/:projectId/lighthouseLog/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { skip, limit, url } = req.query;
            const monitorId = req.params.monitorId;

            const {
                lighthouseLogs,
                count,
            } = await LighthouseLogService.findLastestScan({
                monitorId,
                url,
                limit: limit || 5,
                skip: skip || 0,
            });

            return sendListResponse(req, res, lighthouseLogs, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/lighthouseIssue/:issueId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const lighthouseIssue = await LighthouseLogService.findOneBy({
                _id: req.params.issueId,
            });

            return sendItemResponse(req, res, lighthouseIssue);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/:projectId/inbound/:deviceId',
    getUser,
    isAuthorized,
    async function(req, res) {
        return await _updateDeviceMonitorPingTime(req, res);
    }
);

router.get(
    '/:projectId/inbound/:deviceId',
    getUser,
    isAuthorized,
    async function(req, res) {
        return await _updateDeviceMonitorPingTime(req, res);
    }
);

const _updateDeviceMonitorPingTime = async function(req, res) {
    try {
        const projectId = req.params.projectId;
        const deviceId = req.params.deviceId;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Missing Project ID',
            });
        }

        if (!deviceId) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Missing Device ID',
            });
        }

        const monitor = await MonitorService.updateDeviceMonitorPingTime(
            projectId,
            deviceId
        );
        if (monitor) {
            return sendItemResponse(req, res, monitor);
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message:
                    'Monitor not found or is not associated with this project.',
            });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
};

router.post('/:projectId/addseat', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const seatresponse = await MonitorService.addSeat({
            _id: req.params.projectId,
        });
        return sendItemResponse(req, res, seatresponse);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post(
    '/:projectId/siteUrl/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { siteUrl } = req.body;
            const monitor = await MonitorService.addSiteUrl(
                {
                    _id: req.params.monitorId,
                },
                { siteUrl }
            );
            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/siteUrl/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { siteUrl } = req.body;
            const monitor = await MonitorService.removeSiteUrl(
                {
                    _id: req.params.monitorId,
                },
                { siteUrl }
            );
            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/monitorSlaBreaches',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { projectId } = req.params;
            const monitors = await MonitorService.findBy({
                projectId,
                breachedMonitorSla: true,
            });
            return sendItemResponse(req, res, monitors);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/:projectId/closeSla/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { projectId, monitorId } = req.params;
            const userId = req.user ? req.user.id : null;
            const monitor = await MonitorService.closeBreachedMonitorSla(
                projectId,
                monitorId,
                userId
            );

            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/:projectId/disableMonitor/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { monitorId } = req.params;
            const monitor = await MonitorService.findOneBy({ _id: monitorId });
            const disabled = monitor.disabled ? false : true;
            const newMonitor = await MonitorService.updateOneBy(
                {
                    _id: monitorId,
                },
                { disabled: disabled }
            );
            await ProbeService.createMonitorDisabledStatus({
                monitorId,
                manuallyCreated: true,
                status: disabled ? 'disabled' : 'enable',
            });
            return sendItemResponse(req, res, newMonitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
