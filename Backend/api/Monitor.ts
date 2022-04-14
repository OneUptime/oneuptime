import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
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
import ErrorService from 'CommonServer/Utils/error';
import Api from '../Utils/api';
import BadDataException from 'Common/Types/Exception/BadDataException';
const router: $TSFixMe = express.getRouter();
const isUserAdmin: $TSFixMe = require('../middlewares/project').isUserAdmin;
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const getSubProjects: $TSFixMe = require('../middlewares/subProject').getSubProjects;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/Utils/response';
import multer from 'multer';
import storage from '../middlewares/upload';
import https from 'https';
const httpsAgent: $TSFixMe = new https.Agent({
    rejectUnauthorized: false,
});

// Route
// Description: Adding / Updating a new monitor to the project.
// Params:
// Param 1: req.params-> {projectId}; req.body -> {[_id], name, type, data, visibleOnStatusPage} <- Check MonitorMoal for description.
// Returns: response status, error message
router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req, res): void => {
        try {
            const data: $TSFixMe = req.body;
            const projectId: $TSFixMe = req.params.projectId;

            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "values can't be null",
                });
            }

            data.createdById = req.user ? req.user.id : null;

            /* if (!data.componentId) {
            return sendErrorResponse(req, res, new BadDataException('Component ID is required.'));
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
                        const headers: $TSFixMe = await Api.headers(
                            data.headers,
                            data.bodyType
                        );

                        const body: $TSFixMe = await Api.body(
                            data.text && data.text.length
                                ? data.text
                                : data.formData,
                            data.text && data.text.length ? 'text' : 'formData'
                        );
                        const payload: $TSFixMe = {
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
                        const apiResponse: $TSFixMe = await axios(payload);
                        const headerContentType: $TSFixMe =
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

            const [monitor, user]: $TSFixMe = await Promise.all([
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
                    ErrorService.log(
                        'realtimeService.sendMonitorCreated',
                        error
                    );
                }
            }

            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/identityFile',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const upload: $TSFixMe = multer({
                storage,
            }).fields([
                {
                    name: 'identityFile',
                    maxCount: 1,
                },
            ]);
            upload(req, res, async (error: $TSFixMe): void => {
                let identityFile;
                if (error) {
                    return sendErrorResponse(req, res, error as Exception);
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/configurationFile',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const upload: $TSFixMe = multer({
                storage,
            }).fields([
                {
                    name: 'configurationFile',
                    maxCount: 1,
                },
            ]);
            upload(req, res, async (error: $TSFixMe): void => {
                let configurationFile;
                if (error) {
                    return sendErrorResponse(req, res, error as Exception);
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:monitorId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            const { monitorId }: $TSFixMe = req.params;
            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "values can't be null",
                });
            }
            if (data.type && data.type === 'api') {
                try {
                    const headers: $TSFixMe = await Api.headers(
                        data.headers,
                        data.bodyType
                    );
                    const body: $TSFixMe = await Api.body(
                        data.text && data.text.length
                            ? data.text
                            : data.formData,
                        data.text && data.text.length ? 'text' : 'formData'
                    );
                    const payload: $TSFixMe = {
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
                    const apiResponse: $TSFixMe = await axios(payload);
                    const headerContentType: $TSFixMe =
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

            const monitor: $TSFixMe = await MonitorService.updateOneBy(
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Get all Monitors by projectId.
router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req, res): void => {
        try {
            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;

            const { limit, skip }: $TSFixMe = req.query;
            // Call the MonitorService.
            const monitors: $TSFixMe = await MonitorService.getMonitorsBySubprojects(
                subProjectIds,
                limit || 0,
                skip || 0
            );
            return sendItemResponse(req, res, monitors);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/paginated',
    getUser,
    isAuthorized,
    async (req, res): void => {
        try {
            // const { projectId }: $TSFixMe = req.params;
            const { skip, limit, componentSlug }: $TSFixMe = req.query;
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

            const response: $TSFixMe =
                await MonitorService.getMonitorsBySubprojectsPaginate(
                    component.projectId,
                    componentId,
                    limit,
                    skip
                );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/monitor',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const type: $TSFixMe = req.query.type;

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            const query: $TSFixMe = type
                ? { projectId: { $in: subProjectIds }, type }
                : { projectId: { $in: subProjectIds } };

            const select: $TSFixMe =
                '_id monitorStatus name slug data type monitorSla breachedMonitorSla breachClosedBy componentId projectId incidentCommunicationSla criteria agentlessConfig lastPingTime lastMatchedCriterion method bodyType formData text headers disabled pollTime updateTime customFields';
            const populate: $TSFixMe = [
                {
                    path: 'monitorSla',
                    select: 'frequency _id',
                },
                { path: 'componentId', select: 'name' },
                { path: 'incidentCommunicationSla', select: '_id' },
            ];
            const [monitors, count]: $TSFixMe = await Promise.all([
                MonitorService.findBy({
                    query,
                    limit: req.query['limit'] || 10,
                    skip: req.query['skip'] || 0,
                    select,
                    populate,
                }),
                MonitorService.countBy({
                    projectId: { $in: subProjectIds },
                }),
            ]);
            return sendListResponse(req, res, monitors, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/monitor/:monitorId',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const monitorId: $TSFixMe = req.params.monitorId;
            const type: $TSFixMe = req.query.type;

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            const query: $TSFixMe = type
                ? { _id: monitorId, projectId: { $in: subProjectIds }, type }
                : { _id: monitorId, projectId: { $in: subProjectIds } };

            const select: $TSFixMe =
                '_id monitorStatus name slug data type monitorSla breachedMonitorSla breachClosedBy componentId projectId incidentCommunicationSla criteria agentlessConfig lastPingTime lastMatchedCriterion method bodyType formData text headers disabled pollTime updateTime customFields';
            const populate: $TSFixMe = [
                {
                    path: 'monitorSla',
                    select: 'frequency _id',
                },
                { path: 'componentId', select: 'name' },
                { path: 'incidentCommunicationSla', select: '_id' },
            ];
            const monitor: $TSFixMe = await MonitorService.findOneBy({
                query,
                select,
                populate,
            });
            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Get all Monitor logs by monitorId.
router.post(
    '/:projectId/monitorLogs/:monitorId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
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
            const monitorId: $TSFixMe = req.params.monitorId;
            const query: $TSFixMe = {};
            const selectMonitorLog: $TSFixMe =
                'monitorId probeId status responseTime responseStatus responseBody responseHeader cpuLoad avgCpuLoad cpuCores memoryUsed totalMemory swapUsed storageUsed totalStorage storageUsage mainTemp maxTemp incidentIds createdAt sslCertificate  kubernetesLog scriptMetadata';

            const populateMonitorLog: $TSFixMe = [
                {
                    path: 'probeId',
                    select: 'createdAt lastAlive probeKey probeName version probeImage deleted',
                },
            ];

            if (monitorId && !incidentId) {
                query.monitorId = monitorId;
            }

            if (incidentId) {
                query.incidentIds = incidentId;
            }

            if (probeValue) {
                query.probeId = probeValue;
            }

            if (type === 'incomingHttpRequest') {
                query.probeId = null;
            }
            if (startDate && endDate) {
                query.createdAt = { $gte: startDate, $lte: endDate };
            }

            const [monitorLogs, count]: $TSFixMe = await Promise.all([
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:monitorId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { monitorId, projectId }: $TSFixMe = req.params;
        try {
            const monitor: $TSFixMe = await MonitorService.deleteBy(
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
            return sendErrorResponse(req, res, error as Exception);
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
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const monitorId: $TSFixMe = req.params.monitorId || req.body._id;
            const data: $TSFixMe = req.body;
            data.monitorId = monitorId;

            const select: string = 'type criteria';
            const monitor: $TSFixMe = await MonitorService.findOneBy({
                query: { _id: monitorId },
                select,
            });

            const {
                stat: validUp,
                successReasons: upSuccessReasons,
                failedReasons: upFailedReasons,
            } = monitor && monitor.criteria && monitor.criteria.up
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
            } = monitor && monitor.criteria && monitor.criteria.degraded
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
            } = monitor && monitor.criteria && monitor.criteria.down
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
            const index: $TSFixMe = data.reason.indexOf('Request Timed out');
            if (index > -1) {
                data.reason = data.reason.filter(
                    (item: $TSFixMe) => !item.includes('Response Time is')
                );
            }
            data.reason = data.reason.filter(
                (item: $TSFixMe, pos: $TSFixMe, self: $TSFixMe) =>
                    self.indexOf(item) === pos
            );
            const log: $TSFixMe = await ProbeService.saveMonitorLog(data);

            return sendItemResponse(req, res, log);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Get all Monitor Logs by monitorId
router.post(
    '/:projectId/monitorLog/:monitorId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { startDate, endDate }: $TSFixMe = req.body;
            const monitorId: $TSFixMe = req.params.monitorId;
            const monitorLogs: $TSFixMe = await MonitorService.getMonitorLogs(
                monitorId,
                startDate,
                endDate
            );
            return sendListResponse(req, res, monitorLogs);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Get all Monitor Statuses by monitorId
router.post(
    '/:projectId/monitorStatuses/:monitorId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { startDate, endDate }: $TSFixMe = req.body;
            const monitorId: $TSFixMe = req.params.monitorId;
            const monitorStatuses: $TSFixMe = await MonitorService.getMonitorStatuses(
                monitorId,
                startDate,
                endDate
            );
            return sendListResponse(req, res, monitorStatuses);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Get all Lighthouse Logs by monitorId
router.get(
    '/:projectId/lighthouseLog/:monitorId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { skip, limit, url }: $TSFixMe = req.query;
            const monitorId: $TSFixMe = req.params.monitorId;

            const { lighthouseLogs, count }: $TSFixMe =
                await LighthouseLogService.findLastestScan({
                    monitorId,
                    url,
                    limit: limit || 5,
                    skip: skip || 0,
                });

            return sendListResponse(req, res, lighthouseLogs, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/lighthouseIssue/:issueId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const selectLighthouseLogs: $TSFixMe =
                'monitorId probeId data url performance accessibility bestPractices seo pwa createdAt scanning';

            const populateLighthouseLogs: $TSFixMe = [
                {
                    path: 'probeId',
                    select: 'probeName probeKey version lastAlive deleted probeImage',
                },
            ];
            const lighthouseIssue: $TSFixMe = await LighthouseLogService.findOneBy({
                query: { _id: req.params.issueId },
                select: selectLighthouseLogs,
                populate: populateLighthouseLogs,
            });

            return sendItemResponse(req, res, lighthouseIssue);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/inbound/:deviceId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        return await _updateDeviceMonitorPingTime(req, res);
    }
);

router.get(
    '/:projectId/inbound/:deviceId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        return await _updateDeviceMonitorPingTime(req, res);
    }
);

const _updateDeviceMonitorPingTime: $TSFixMe = async function (
    req: ExpressRequest,
    res: ExpressResponse
): void {
    try {
        const projectId: $TSFixMe = req.params.projectId;
        const deviceId: $TSFixMe = req.params.deviceId;

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

        const monitor: $TSFixMe = await MonitorService.updateDeviceMonitorPingTime(
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
        return sendErrorResponse(req, res, error as Exception);
    }
};

router.post(
    '/:projectId/addseat',
    getUser,
    isAuthorized,
    async (req, res): void => {
        try {
            const seatresponse: $TSFixMe = await MonitorService.addSeat({
                _id: req.params.projectId,
            });
            return sendItemResponse(req, res, seatresponse);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/siteUrl/:monitorId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { siteUrl }: $TSFixMe = req.body;
            const monitor: $TSFixMe = await MonitorService.addSiteUrl(
                {
                    _id: req.params.monitorId,
                },
                { siteUrl }
            );
            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/siteUrl/:monitorId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { siteUrl }: $TSFixMe = req.body;
            const monitor: $TSFixMe = await MonitorService.removeSiteUrl(
                {
                    _id: req.params.monitorId,
                },
                { siteUrl }
            );
            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/monitorSlaBreaches',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;
            const select: $TSFixMe =
                '_id name slug data type monitorSla breachedMonitorSla breachClosedBy componentId projectId incidentCommunicationSla criteria agentlessConfig lastPingTime lastMatchedCriterion method bodyType formData text headers disabled pollTime updateTime customFields';
            const monitors: $TSFixMe = await MonitorService.findBy({
                query: { projectId, breachedMonitorSla: true },
                select,
            });
            return sendItemResponse(req, res, monitors);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/closeSla/:monitorId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, monitorId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user ? req.user.id : null;
            const monitor: $TSFixMe = await MonitorService.closeBreachedMonitorSla(
                projectId,
                monitorId,
                userId
            );

            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/disableMonitor/:monitorId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { monitorId }: $TSFixMe = req.params;
            const select: string = 'disabled';
            const monitor: $TSFixMe = await MonitorService.findOneBy({
                query: { _id: monitorId },
                select,
            });

            const disabled: $TSFixMe = monitor.disabled ? false : true;
            await Promise.all([
                MonitorService.disableMonitor(monitorId, disabled), // This enables or disables the monitor as needed.

                ProbeService.createMonitorDisabledStatus({
                    monitorId,
                    manuallyCreated: true,
                    status: disabled ? 'disabled' : 'enable',
                }),
            ]);
            // This fetch the values of the updated monitor needed to update UI state.
            const updatedMonitor: $TSFixMe = await MonitorService.findOneBy({
                query: { _id: monitorId },
                select: '_id disabled',
            });
            return sendItemResponse(req, res, updatedMonitor);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/changeComponent/:monitorId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, monitorId }: $TSFixMe = req.params;
            const { newComponentId }: $TSFixMe = req.body;
            const monitor: $TSFixMe = await MonitorService.changeMonitorComponent(
                projectId,
                monitorId,
                newComponentId
            );
            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// api to calculate time for monitorInfo (status page)
router.post(
    '/:monitorId/calculate-time',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { monitorId }: $TSFixMe = req.params;
            const { statuses, start, range }: $TSFixMe = req.body;

            const select: string = '_id';
            const [monitor, result]: $TSFixMe = await Promise.all([
                MonitorService.findOneBy({ query: { _id: monitorId }, select }),
                MonitorService.calcTime(statuses, start, range),
            ]);

            if (!monitor) {
                throw new BadDataException(
                    'Monitor not found or does not exist'
                );
            }

            result.monitorId = monitor._id;

            return sendItemResponse(req, res, result);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
