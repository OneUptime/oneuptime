import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';
import ProbeService from '../services/probeService';
import MonitorService from '../services/monitorService';
import LighthouseLogService from '../services/lighthouseLogService';
const router = express.getRouter();
const isAuthorizedAdmin =
    require('../middlewares/clusterAuthorization').isAuthorizedAdmin;
import { isAuthorizedProbe } from '../middlewares/probeAuthorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';
import Exception from 'common/types/exception/Exception';

import { sendListResponse } from 'common-server/utils/response';
const getUser = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
import multer from 'multer';
import storage from '../middlewares/upload';

router.post(
    '/',
    getUser,
    isAuthorizedAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data = req.body;
            const probe = await ProbeService.create(data);
            return sendItemResponse(req, res, probe);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/',
    getUser,
    isAuthorizedAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const skip = req.query['skip'] || 0;
            const limit = req.query['limit'] || 0;
            const selectProbe =
                'createdAt probeKey probeName version lastAlive deleted deletedAt probeImage';
            const [probe, count] = await Promise.all([
                ProbeService.findBy({
                    query: {},
                    limit,
                    skip,
                    select: selectProbe,
                }),
                ProbeService.countBy({}),
            ]);
            return sendListResponse(req, res, probe, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:id',
    getUser,
    isAuthorizedAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data = req.body;
            const probe = await ProbeService.updateOneBy(
                { _id: req.params.id },
                data
            );
            return sendItemResponse(req, res, probe);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:id',
    getUser,
    isAuthorizedAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const probe = await ProbeService.deleteBy({ _id: req.params.id });
            return sendItemResponse(req, res, probe);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Updating profile setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic};
// Returns: 200: Success, 400: Error; 500: Server Error.

router.put(
    '/update/image',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const upload = multer({
                storage,
            }).fields([
                {
                    name: 'probeImage',
                    maxCount: 1,
                },
            ]);
            upload(req, res, async function (error: $TSFixMe) {
                const probeId = req.body.id;
                const data = req.body;

                if (error) {
                    return sendErrorResponse(req, res, error as Exception);
                }
                if (
                    req.files &&
                    req.files.probeImage &&
                    req.files.probeImage[0].filename
                ) {
                    data.probeImage = req.files.probeImage[0].filename;
                }

                // Call the ProbeService
                const save = await ProbeService.updateOneBy(
                    { _id: probeId },
                    data
                );
                return sendItemResponse(req, res, save);
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/monitors',
    isAuthorizedProbe,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const monitors = await MonitorService.getProbeMonitors(
                req.probe.id,
                new Date(new Date().getTime() - 60 * 1000)
            );

            return sendListResponse(
                req,
                res,
                JSON.stringify(monitors),
                monitors.length
            );
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/ping/:monitorId',
    isAuthorizedProbe,
    async function (req, response) {
        try {
            const {
                monitor,
                res,
                resp,
                rawResp,
                serverData,
                type,
                retryCount,
                kubernetesData,
            } = req.body;
            const { monitorId } = req.params;

            let status,
                log,
                reason,
                data = {};
            let matchedCriterion;

            if (type === 'incomingHttpRequest') {
                const newMonitor = await MonitorService.findOneBy({
                    query: { _id: monitor._id },
                    select: 'lastPingTime _id criteria',
                });

                const probeId = req.probe && req.probe.id ? req.probe.id : null;
                log = await ProbeService.probeHttpRequest(newMonitor, probeId);
            } else {
                if (type === 'api' || type === 'url') {
                    const {
                        stat: validUp,
                        successReasons: upSuccessReasons,
                        failedReasons: upFailedReasons,
                        matchedCriterion: matchedUpCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.up
                        ? ProbeService.conditions(
                              monitor.type,
                              monitor.criteria.up,
                              res,
                              resp,
                              rawResp
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };
                    const {
                        stat: validDegraded,
                        successReasons: degradedSuccessReasons,
                        failedReasons: degradedFailedReasons,
                        matchedCriterion: matchedDegradedCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.degraded
                        ? ProbeService.conditions(
                              monitor.type,
                              monitor.criteria.degraded,
                              res,
                              resp,
                              rawResp
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };
                    const {
                        stat: validDown,
                        successReasons: downSuccessReasons,
                        failedReasons: downFailedReasons,
                        matchedCriterion: matchedDownCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.down
                        ? ProbeService.conditions(
                              monitor.type,
                              [
                                  ...monitor.criteria.down.filter(
                                      (criterion: $TSFixMe) =>
                                          criterion.default !== true
                                  ),
                              ],
                              res,
                              resp,
                              rawResp
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };

                    if (validUp) {
                        status = 'online';
                        reason = upSuccessReasons;
                        matchedCriterion = matchedUpCriterion;
                    } else if (validDegraded) {
                        status = 'degraded';
                        reason = [
                            ...degradedSuccessReasons,
                            ...upFailedReasons,
                        ];
                        matchedCriterion = matchedDegradedCriterion;
                    } else if (validDown) {
                        matchedCriterion = matchedDownCriterion;
                        status = 'offline';
                        reason = [
                            ...downSuccessReasons,
                            ...degradedFailedReasons,
                            ...upFailedReasons,
                        ];
                    } else {
                        status = 'offline';
                        reason = [
                            ...downFailedReasons,
                            ...degradedFailedReasons,
                            ...upFailedReasons,
                        ];
                        if (monitor.criteria.down) {
                            matchedCriterion = monitor.criteria.down.find(
                                (criterion: $TSFixMe) =>
                                    criterion.default === true
                            );
                        }
                    }

                    data.status = status;

                    data.reason = reason;
                }
                if (type === 'ip') {
                    const {
                        stat: validUp,
                        successReasons: upSuccessReasons,
                        failedReasons: upFailedReasons,
                        matchedCriterion: matchedUpCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.up
                        ? ProbeService.conditions(
                              monitor.type,
                              monitor.criteria.up,
                              res,
                              resp,
                              rawResp
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };
                    const {
                        stat: validDown,
                        successReasons: downSuccessReasons,
                        failedReasons: downFailedReasons,
                        matchedCriterion: matchedDownCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.down
                        ? ProbeService.conditions(
                              monitor.type,
                              [
                                  ...monitor.criteria.down.filter(
                                      (criterion: $TSFixMe) =>
                                          criterion.default !== true
                                  ),
                              ],
                              res,
                              resp,
                              rawResp
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };
                    if (validUp) {
                        status = 'online';
                        reason = upSuccessReasons;
                        matchedCriterion = matchedUpCriterion;
                    } else if (validDown) {
                        matchedCriterion = matchedDownCriterion;
                        status = 'offline';
                        reason = [
                            ...downSuccessReasons,
                            null,
                            ...upFailedReasons,
                        ];
                    } else {
                        status = 'offline';
                        reason = [
                            ...downFailedReasons,
                            null,
                            ...upFailedReasons,
                        ];
                        if (monitor.criteria.down) {
                            matchedCriterion = monitor.criteria.down.find(
                                (criterion: $TSFixMe) =>
                                    criterion.default === true
                            );
                        }
                    }

                    data.status = status;

                    data.reason = reason;
                }
                if (type === 'script') {
                    const {
                        stat: validUp,
                        successReasons: upSuccessReasons,
                        failedReasons: upFailedReasons,
                        matchedCriterion: matchedUpCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.up
                        ? ProbeService.scriptConditions(
                              resp,
                              monitor.criteria.up
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };

                    const {
                        stat: validDown,
                        successReasons: downSuccessReasons,
                        failedReasons: downFailedReasons,
                        matchedCriterion: matchedDownCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.down
                        ? ProbeService.scriptConditions(resp, [
                              ...monitor.criteria.down.filter(
                                  (criterion: $TSFixMe) =>
                                      criterion.default !== true
                              ),
                          ])
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };

                    const {
                        stat: validDegraded,
                        successReasons: degradedSuccessReasons,
                        failedReasons: degradedFailedReasons,
                        matchedCriterion: matchedDegradedCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.degraded
                        ? ProbeService.scriptConditions(
                              resp,
                              monitor.criteria.degraded
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };

                    if (validUp) {
                        status = 'online';
                        reason = upSuccessReasons;
                        matchedCriterion = matchedUpCriterion;
                    } else if (validDown) {
                        status = 'offline';
                        reason = [...downSuccessReasons, ...upFailedReasons];
                        matchedCriterion = matchedDownCriterion;
                    } else if (validDegraded) {
                        status = 'degraded';
                        reason = [
                            ...degradedSuccessReasons,
                            ...upFailedReasons,
                            ...downFailedReasons,
                        ];
                        matchedCriterion = matchedDegradedCriterion;
                    } else {
                        status = 'offline';
                        reason = [
                            ...downFailedReasons,
                            ...upFailedReasons,
                            ...degradedFailedReasons,
                        ];
                        if (monitor.criteria.down) {
                            matchedCriterion = monitor.criteria.down.find(
                                (criterion: $TSFixMe) =>
                                    criterion.default === true
                            );
                        }
                    }

                    data.status = status;

                    data.reason = reason;
                }
                if (type === 'server-monitor') {
                    data = serverData;
                    const {
                        stat: validUp,
                        successReasons: upSuccessReasons,
                        failedReasons: upFailedReasons,
                        matchedCriterion: matchedUpCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.up
                        ? ProbeService.conditions(
                              monitor.type,
                              monitor.criteria.up,
                              data
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };
                    const {
                        stat: validDegraded,
                        successReasons: degradedSuccessReasons,
                        failedReasons: degradedFailedReasons,
                        matchedCriterion: matchedDegradedCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.degraded
                        ? ProbeService.conditions(
                              monitor.type,
                              monitor.criteria.degraded,
                              data
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };
                    const {
                        stat: validDown,
                        successReasons: downSuccessReasons,
                        failedReasons: downFailedReasons,
                        matchedCriterion: matchedDownCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.down
                        ? ProbeService.conditions(
                              monitor.type,
                              [
                                  ...monitor.criteria.down.filter(
                                      (criterion: $TSFixMe) =>
                                          criterion.default !== true
                                  ),
                              ],
                              data
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };

                    if (validUp) {
                        data.status = 'online';

                        data.reason = upSuccessReasons;
                        matchedCriterion = matchedUpCriterion;
                    } else if (validDegraded) {
                        data.status = 'degraded';

                        data.reason = [
                            ...degradedSuccessReasons,
                            ...upFailedReasons,
                        ];
                        matchedCriterion = matchedDegradedCriterion;
                    } else if (validDown) {
                        data.status = 'offline';

                        data.reason = [
                            ...downSuccessReasons,
                            ...degradedFailedReasons,
                            ...upFailedReasons,
                        ];
                        matchedCriterion = matchedDownCriterion;
                    } else {
                        data.status = 'offline';

                        data.reason = [
                            ...downFailedReasons,
                            ...degradedFailedReasons,
                            ...upFailedReasons,
                        ];
                        if (monitor.criteria.down) {
                            matchedCriterion = monitor.criteria.down.find(
                                (criterion: $TSFixMe) =>
                                    criterion.default === true
                            );
                        }
                    }
                } else {
                    data = req.body;

                    data.responseTime = res || 0;

                    data.responseStatus =
                        resp && resp.status ? resp.status : null;

                    data.status = status;

                    data.sslCertificate =
                        resp && resp.sslCertificate
                            ? resp.sslCertificate
                            : null;

                    data.lighthouseScanStatus =
                        resp && resp.lighthouseScanStatus
                            ? resp.lighthouseScanStatus
                            : null;

                    data.performance =
                        resp && resp.performance ? resp.performance : null;

                    data.accessibility =
                        resp && resp.accessibility ? resp.accessibility : null;

                    data.bestPractices =
                        resp && resp.bestPractices ? resp.bestPractices : null;

                    data.seo = resp && resp.seo ? resp.seo : null;

                    data.pwa = resp && resp.pwa ? resp.pwa : null;

                    data.lighthouseData =
                        resp && resp.lighthouseData
                            ? resp.lighthouseData
                            : null;

                    data.retryCount = retryCount || 0;

                    data.reason = reason;

                    data.response = rawResp;
                }
                if (type === 'kubernetes') {
                    data = { kubernetesData };

                    const {
                        stat: validUp,
                        successReasons: upSuccessReasons,
                        failedReasons: upFailedReasons,
                        matchedCriterion: matchedUpCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.up
                        ? ProbeService.conditions(
                              monitor.type,
                              monitor.criteria.up,

                              data.kubernetesData
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };

                    const {
                        stat: validDegraded,
                        successReasons: degradedSuccessReasons,
                        failedReasons: degradedFailedReasons,
                        matchedCriterion: matchedDegradedCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.degraded
                        ? ProbeService.conditions(
                              monitor.type,
                              monitor.criteria.degraded,

                              data.kubernetesData
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };

                    const {
                        stat: validDown,
                        successReasons: downSuccessReasons,
                        failedReasons: downFailedReasons,
                        matchedCriterion: matchedDownCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.down
                        ? ProbeService.conditions(
                              monitor.type,
                              [
                                  ...monitor.criteria.down.filter(
                                      (criterion: $TSFixMe) =>
                                          criterion.default !== true
                                  ),
                              ],

                              data.kubernetesData
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };

                    if (validUp) {
                        data.status = 'online';

                        data.reason = upSuccessReasons;
                        matchedCriterion = matchedUpCriterion;
                    } else if (validDegraded) {
                        data.status = 'degraded';

                        data.reason = [
                            ...degradedSuccessReasons,
                            ...upFailedReasons,
                        ];
                        matchedCriterion = matchedDegradedCriterion;
                    } else if (validDown) {
                        data.status = 'offline';

                        data.reason = [
                            ...downSuccessReasons,
                            ...degradedFailedReasons,
                            ...upFailedReasons,
                        ];
                        matchedCriterion = matchedDownCriterion;
                    } else {
                        data.status = 'offline';

                        data.reason = [
                            ...downFailedReasons,
                            ...degradedFailedReasons,
                            ...upFailedReasons,
                        ];
                        if (monitor.criteria.down) {
                            matchedCriterion = monitor.criteria.down.find(
                                (criterion: $TSFixMe) =>
                                    criterion.default === true
                            );
                        }
                    }
                }

                if (type === 'script') {
                    data.scriptMetadata = {
                        executionTime: resp.executionTime,
                        consoleLogs: resp.consoleLogs,
                        error: resp.error,
                        statusText: resp.statusText,
                    };
                }

                data.matchedCriterion = matchedCriterion;
                // update monitor to save the last matched criterion

                await MonitorService.updateCriterion(
                    monitor._id,
                    matchedCriterion
                );

                data.monitorId = monitorId || monitor._id;

                data.probeId = req.probe && req.probe.id ? req.probe.id : null;

                data.reason =
                    data && data.reason && data.reason.length
                        ? data.reason.filter(
                              (item: $TSFixMe, pos: $TSFixMe, self: $TSFixMe) =>
                                  self.indexOf(item) === pos
                          )
                        : data.reason;
                const index =
                    data.reason && data.reason.indexOf('Request Timed out');
                if (index > -1) {
                    data.reason =
                        data && data.reason && data.reason.length
                            ? data.reason.filter(
                                  (item: $TSFixMe) =>
                                      !item.includes('Response Time is')
                              )
                            : data.reason;
                }

                if (data.lighthouseScanStatus) {
                    if (data.lighthouseScanStatus === 'scanning') {
                        await Promise.all([
                            MonitorService.updateLighthouseScanStatus(
                                data.monitorId,
                                'scanning'
                            ),

                            LighthouseLogService.updateAllLighthouseLogs(
                                data.monitorId,
                                { scanning: true }
                            ),
                        ]);
                    } else {
                        // when this is scanned success or failed.
                        await MonitorService.updateLighthouseScanStatus(
                            data.monitorId,

                            data.lighthouseScanStatus,

                            data.probeId
                        );
                    }
                } else {
                    if (data.lighthouseData) {
                        data.scanning = false;
                        log = await ProbeService.saveLighthouseLog(data);
                    } else {
                        data.matchedUpCriterion =
                            monitor && monitor.criteria && monitor.criteria.up;

                        data.matchedDownCriterion =
                            monitor &&
                            monitor.criteria &&
                            monitor.criteria.down;

                        data.matchedDegradedCriterion =
                            monitor &&
                            monitor.criteria &&
                            monitor.criteria.degraded;

                        log = await ProbeService.saveMonitorLog(data);

                        if (type === 'script') {
                            await MonitorService.updateScriptStatus(
                                monitorId,
                                'completed',

                                req.probe.id
                            );
                        }
                    }
                }
            }
            return sendItemResponse(req, response, log);
        } catch (error) {
            return sendErrorResponse(req, response, error);
        }
    }
);

router.post(
    '/setTime/:monitorId',
    isAuthorizedProbe,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data = req.body;

            data.probeId = req.probe.id;
            data.monitorId = req.params.monitorId;
            const log = await ProbeService.saveMonitorLog(data);
            return sendItemResponse(req, res, log);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/getTime/:monitorId',
    isAuthorizedProbe,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data = req.body;

            data.probeId = req.probe.id;
            data.monitorId = req.params.monitorId;
            const log = await ProbeService.getMonitorLog(data);
            return sendItemResponse(req, res, log);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/probes',
    getUser,
    isAuthorized,
    async function (req, res) {
        try {
            const limit = req.query['limit'] || null;
            const skip = req.query['skip'] || null;
            const selectProbe =
                'createdAt probeKey probeName version lastAlive deleted deletedAt probeImage';
            const [probe, count] = await Promise.all([
                ProbeService.findBy({
                    query: {},
                    limit,
                    skip,
                    select: selectProbe,
                }),
                ProbeService.countBy({}),
            ]);
            return sendListResponse(req, res, probe, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
