import express from 'express';
import axios from 'axios';
import UserService from '../services/userService';
import MonitorService from '../services/monitorService';
import MonitorLogService from '../services/monitorLogService';
import LighthouseLogService from '../services/lighthouseLogService';
import NotificationService from '../services/notificationService';
import RealTimeService from '../services/realTimeService';
import ScheduleService from '../services/scheduleService';
import ProbeService from '../services/probeService';
import ComponentService from '../services/componentService';
import ErrorService from 'common-server/utils/error';
import Api from '../utils/api';

const router = express.Router();
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;

import { isAuthorized } from '../middlewares/authorization';
import { sendErrorResponse, sendItemResponse } from 'common-server/utils/response';

import { sendListResponse } from 'common-server/utils/response';
import multer from 'multer';
import storage from '../middlewares/upload';
import https from 'https';
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

// Route
// Description: Adding / Updating a new monitor to the project.
// Params:
// Param 1: req.params-> {projectId}; req.body -> {[_id], name, type, data, visibleOnStatusPage} <- Check MonitorMoal for description.
// Returns: response status, error message
router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function (
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

        const [monitor, user] = await Promise.all([
            MonitorService.create(data),
            UserService.findOneBy({
                query: { _id: req.user.id },
                select: 'name _id',
            }),
        ]);

        if (data.callScheduleIds && data.callScheduleIds.length) {
            await ScheduleService.addMonitorToSchedules(
                data.callScheduleIds,
                monitor._id
            );
        }

        if (monitor) {
            try {
                NotificationService.create(
                    monitor.projectId._id || monitor.projectId,
                    `A New Monitor was Created with name ${monitor.name} by ${user.name}`,
                    user._id,
                    'monitoraddremove'
                );

                // RUN REALTIME SERVICE IN THE BACKGROUND
                RealTimeService.sendMonitorCreated(monitor);
            } catch (error) {
                ErrorService.log('realtimeService.sendMonitorCreated', error);
            }
        }

        return sendItemResponse(req, res, monitor);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/identityFile', async function (
    req: Request,
    res: Response
) {
    try {
        const upload = multer({
            storage,
        }).fields([
            {
                name: 'identityFile',
                maxCount: 1,
            },
        ]);
        upload(req, res, async function (error: $TSFixMe) {
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

router.post('/:projectId/configurationFile', async function (
    req: Request,
    res: Response
) {
    try {
        const upload = multer({
            storage,
        }).fields([
            {
                name: 'configurationFile',
                maxCount: 1,
            },
        ]);
        upload(req, res, async function (error: $TSFixMe) {
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
    async function (req: Request, res: Response) {
        try {
            const data = req.body;
            const { monitorId } = req.params;
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

            await ScheduleService.deleteMonitor(monitorId);
            if (data.callScheduleIds && data.callScheduleIds.length) {
                await ScheduleService.addMonitorToSchedules(
                    data.callScheduleIds,
                    monitorId
                );
            }

            let unsetData;
            if (!data.resourceCategory || data.resourceCategory === '') {
                unsetData = { resourceCategory: '' };
            }

            const monitor = await MonitorService.updateOneBy(
                { _id: monitorId },
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
router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function (
    req,
    res
) {
    try {
        const subProjectIds = req.user.subProjects
            ? req.user.subProjects.map((project: $TSFixMe) => project._id)
            : null;

        const { limit, skip } = req.query;
        // Call the MonitorService.
        const monitors = await MonitorService.getMonitorsBySubprojects(
            subProjectIds,
            limit || 0,
            skip || 0
        );
        return sendItemResponse(req, res, monitors);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/paginated', getUser, isAuthorized, async function (
    req,
    res
) {
    try {
        // const { projectId } = req.params;
        const { skip, limit, componentSlug } = req.query;
        let componentId = req.query.componentId;

        let component;
        if (!componentId) {
            if (!componentSlug) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Provide either componentSlug or componentId as a query',
                });
            }

            component = await ComponentService.findOneBy({
                query: { slug: componentSlug },
                select: '_id projectId',
            });
            componentId = component?._id;
        } else {
            component = await ComponentService.findOneBy({
                query: { _id: componentId },
                select: 'projectId',
            });
        }

        const response = await MonitorService.getMonitorsBySubprojectsPaginate(
            component.projectId,
            componentId,
            limit,
            skip
        );
        return sendItemResponse(req, res, response);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/monitor',
    getUser,
    isAuthorized,
    getSubProjects,
    async function (req: Request, res: Response) {
        try {
            const type = req.query.type;

            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            const query = type
                ? { projectId: { $in: subProjectIds }, type }
                : { projectId: { $in: subProjectIds } };

            const select =
                '_id monitorStatus name slug data type monitorSla breachedMonitorSla breachClosedBy componentId projectId incidentCommunicationSla criteria agentlessConfig lastPingTime lastMatchedCriterion method bodyType formData text headers disabled pollTime updateTime customFields';
            const populate = [
                {
                    path: 'monitorSla',
                    select: 'frequency _id',
                },
                { path: 'componentId', select: 'name' },
                { path: 'incidentCommunicationSla', select: '_id' },
            ];
            const [monitors, count] = await Promise.all([
                MonitorService.findBy({
                    query,
                    limit: req.query.limit || 10,
                    skip: req.query.skip || 0,
                    select,
                    populate,
                }),
                MonitorService.countBy({
                    projectId: { $in: subProjectIds },
                }),
            ]);
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
    async function (req: Request, res: Response) {
        try {
            const monitorId = req.params.monitorId;
            const type = req.query.type;

            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            const query = type
                ? { _id: monitorId, projectId: { $in: subProjectIds }, type }
                : { _id: monitorId, projectId: { $in: subProjectIds } };

            const select =
                '_id monitorStatus name slug data type monitorSla breachedMonitorSla breachClosedBy componentId projectId incidentCommunicationSla criteria agentlessConfig lastPingTime lastMatchedCriterion method bodyType formData text headers disabled pollTime updateTime customFields';
            const populate = [
                {
                    path: 'monitorSla',
                    select: 'frequency _id',
                },
                { path: 'componentId', select: 'name' },
                { path: 'incidentCommunicationSla', select: '_id' },
            ];
            const monitor = await MonitorService.findOneBy({
                query,
                select,
                populate,
            });
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
    async function (req: Request, res: Response) {
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
            const selectMonitorLog =
                'monitorId probeId status responseTime responseStatus responseBody responseHeader cpuLoad avgCpuLoad cpuCores memoryUsed totalMemory swapUsed storageUsed totalStorage storageUsage mainTemp maxTemp incidentIds createdAt sslCertificate  kubernetesLog scriptMetadata';

            const populateMonitorLog = [
                {
                    path: 'probeId',
                    select:
                        'createdAt lastAlive probeKey probeName version probeImage deleted',
                },
            ];

            if (monitorId && !incidentId) query.monitorId = monitorId;

            if (incidentId) query.incidentIds = incidentId;

            if (probeValue) query.probeId = probeValue;

            if (type === 'incomingHttpRequest') query.probeId = null;
            if (startDate && endDate)
                query.createdAt = { $gte: startDate, $lte: endDate };

            const [monitorLogs, count] = await Promise.all([
                MonitorLogService.findBy({
                    query,
                    limit: limit || 10,
                    skip: skip || 0,
                    populate: populateMonitorLog,
                    select: selectMonitorLog,
                }),
                MonitorLogService.countBy(query),
            ]);
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
    async function (req: Request, res: Response) {
        const { monitorId, projectId } = req.params;
        try {
            const monitor = await MonitorService.deleteBy(
                { _id: monitorId, projectId: projectId },

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
    async function (req: Request, res: Response) {
        try {
            const monitorId = req.params.monitorId || req.body._id;
            const data = req.body;
            data.monitorId = monitorId;

            const select = 'type criteria';
            const monitor = await MonitorService.findOneBy({
                query: { _id: monitorId },
                select,
            });

            const {
                stat: validUp,
                successReasons: upSuccessReasons,
                failedReasons: upFailedReasons,
            } =
                monitor && monitor.criteria && monitor.criteria.up
                    ? ProbeService.conditions(
                        monitor.type,
                        monitor.criteria.up,
                        data
                    )
                    : { stat: false, failedReasons: [], successReasons: [] };
            const {
                stat: validDegraded,
                successReasons: degradedSuccessReasons,
                failedReasons: degradedFailedReasons,
            } =
                monitor && monitor.criteria && monitor.criteria.degraded
                    ? ProbeService.conditions(
                        monitor.type,
                        monitor.criteria.degraded,
                        data
                    )
                    : { stat: false, failedReasons: [], successReasons: [] };
            const {
                stat: validDown,
                successReasons: downSuccessReasons,
                failedReasons: downFailedReasons,
            } =
                monitor && monitor.criteria && monitor.criteria.down
                    ? ProbeService.conditions(
                        monitor.type,
                        monitor.criteria.down,
                        data
                    )
                    : { stat: false, failedReasons: [], successReasons: [] };

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
                    (item: $TSFixMe) => !item.includes('Response Time is')
                );
            }
            data.reason = data.reason.filter(
                (item: $TSFixMe, pos: $TSFixMe, self: $TSFixMe) =>
                    self.indexOf(item) === pos
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
    async function (req: Request, res: Response) {
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
    async function (req: Request, res: Response) {
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
    async function (req: Request, res: Response) {
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
    async function (req: Request, res: Response) {
        try {
            const selectLighthouseLogs =
                'monitorId probeId data url performance accessibility bestPractices seo pwa createdAt scanning';

            const populateLighthouseLogs = [
                {
                    path: 'probeId',
                    select:
                        'probeName probeKey version lastAlive deleted probeImage',
                },
            ];
            const lighthouseIssue = await LighthouseLogService.findOneBy({
                query: { _id: req.params.issueId },
                select: selectLighthouseLogs,
                populate: populateLighthouseLogs,
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
    async function (req: Request, res: Response) {
        return await _updateDeviceMonitorPingTime(req, res);
    }
);

router.get(
    '/:projectId/inbound/:deviceId',
    getUser,
    isAuthorized,
    async function (req: Request, res: Response) {
        return await _updateDeviceMonitorPingTime(req, res);
    }
);

const _updateDeviceMonitorPingTime = async function (
    req: $TSFixMe,
    res: $TSFixMe
) {
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

router.post('/:projectId/addseat', getUser, isAuthorized, async function (
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
    async function (req: Request, res: Response) {
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
    async function (req: Request, res: Response) {
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
    async function (req: Request, res: Response) {
        try {
            const { projectId } = req.params;
            const select =
                '_id name slug data type monitorSla breachedMonitorSla breachClosedBy componentId projectId incidentCommunicationSla criteria agentlessConfig lastPingTime lastMatchedCriterion method bodyType formData text headers disabled pollTime updateTime customFields';
            const monitors = await MonitorService.findBy({
                query: { projectId, breachedMonitorSla: true },
                select,
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
    async function (req: Request, res: Response) {
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
    async function (req: Request, res: Response) {
        try {
            const { monitorId } = req.params;
            const select = 'disabled';
            const monitor = await MonitorService.findOneBy({
                query: { _id: monitorId },
                select,
            });

            const disabled = monitor.disabled ? false : true;
            await Promise.all([
                MonitorService.disableMonitor(monitorId, disabled), // This enables or disables the monitor as needed.

                ProbeService.createMonitorDisabledStatus({
                    monitorId,
                    manuallyCreated: true,
                    status: disabled ? 'disabled' : 'enable',
                }),
            ]);
            // This fetch the values of the updated monitor needed to update UI state.
            const updatedMonitor = await MonitorService.findOneBy({
                query: { _id: monitorId },
                select: '_id disabled',
            });
            return sendItemResponse(req, res, updatedMonitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/:projectId/changeComponent/:monitorId',
    getUser,
    isAuthorized,
    async function (req: Request, res: Response) {
        try {
            const { projectId, monitorId } = req.params;
            const { newComponentId } = req.body;
            const monitor = await MonitorService.changeMonitorComponent(
                projectId,
                monitorId,
                newComponentId
            );
            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// api to calculate time for monitorInfo (status page)
router.post('/:monitorId/calculate-time', async function (
    req: Request,
    res: Response
) {
    try {
        const { monitorId } = req.params;
        const { statuses, start, range } = req.body;

        const select = '_id';
        const [monitor, result] = await Promise.all([
            MonitorService.findOneBy({ query: { _id: monitorId }, select }),
            MonitorService.calcTime(statuses, start, range),
        ]);

        if (!monitor) {
            const error = new Error('Monitor not found or does not exist');

            error.code = 400;
            throw error;
        }

        result.monitorId = monitor._id;

        return sendItemResponse(req, res, result);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
