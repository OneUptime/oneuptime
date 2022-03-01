import express from 'express';
import ProbeService from '../services/probeService';
import MonitorService from '../services/monitorService';
import LighthouseLogService from '../services/lighthouseLogService';
const router = express.Router();
const isAuthorizedProbe = require('../middlewares/probeAuthorization')
    .isAuthorizedProbe;
import { sendErrorResponse, sendItemResponse } from 'common-server/utils/response';

import {
    sendEmptyResponse
} from 'common-server/utils/response';

import { ObjectId } from 'mongodb';

router.post('/ping/:monitorId', isAuthorizedProbe, async function (
    req: $TSFixMe,
    response: $TSFixMe
) {
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
                query: { _id: ObjectId(monitor._id) },
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
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.up
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

                    // failedReasons: degradedFailedReasons,
                    matchedCriterion: matchedDegradedCriterion,
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.degraded
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

                    // failedReasons: downFailedReasons,
                    matchedCriterion: matchedDownCriterion,
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.down
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

                const [up, degraded, down] = await Promise.all([
                    validUp,
                    validDegraded,
                    validDown,
                ]);

                if (up) {
                    status = 'online';
                    reason = upSuccessReasons;
                    matchedCriterion = matchedUpCriterion;
                } else if (degraded) {
                    status = 'degraded';
                    reason = degradedSuccessReasons;
                    matchedCriterion = matchedDegradedCriterion;
                } else if (down) {
                    matchedCriterion = matchedDownCriterion;
                    status = 'offline';
                    reason = downSuccessReasons;
                } else {
                    status = 'offline';
                    reason = upFailedReasons;
                    if (monitor.criteria.down) {
                        matchedCriterion = monitor.criteria.down.find(
                            (criterion: $TSFixMe) => criterion.default === true
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
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.up
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
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.down
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
                    reason = [...downSuccessReasons, null, ...upFailedReasons];
                } else {
                    status = 'offline';
                    reason = [...downFailedReasons, null, ...upFailedReasons];
                    if (monitor.criteria.down) {
                        matchedCriterion = monitor.criteria.down.find(
                            (criterion: $TSFixMe) => criterion.default === true
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
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.up
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
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.down
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
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.degraded
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
                            (criterion: $TSFixMe) => criterion.default === true
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
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.up
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
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.degraded
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
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.down
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
                            (criterion: $TSFixMe) => criterion.default === true
                        );
                    }
                }
            } else {
                data = req.body;

                data.responseTime = res || 0;

                data.responseStatus = resp && resp.status ? resp.status : null;

                data.status = status;

                data.sslCertificate =
                    resp && resp.sslCertificate ? resp.sslCertificate : null;

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
                    resp && resp.lighthouseData ? resp.lighthouseData : null;

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
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.up
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
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.degraded
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
                }: $TSFixMe =
                    monitor && monitor.criteria && monitor.criteria.down
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
                            (criterion: $TSFixMe) => criterion.default === true
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
            await MonitorService.updateCriterion(monitor._id, matchedCriterion);

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
                        monitor && monitor.criteria && monitor.criteria.down;

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
});

router.post('/setTime/:monitorId', isAuthorizedProbe, async function (
    req: $TSFixMe,
    res: $TSFixMe
) {
    try {
        const data = req.body;
        data.probeId = req.probe.id;
        data.monitorId = req.params.monitorId;
        const log = await ProbeService.saveMonitorLog(data);
        return sendItemResponse(req, res, log);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/getTime/:monitorId', isAuthorizedProbe, async function (
    req: $TSFixMe,
    res: $TSFixMe
) {
    try {
        const data = req.body;
        data.probeId = req.probe.id;
        data.monitorId = req.params.monitorId;
        const log = await ProbeService.getMonitorLog(data);
        return sendItemResponse(req, res, log);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/set-scan-status', isAuthorizedProbe, async function (
    req: $TSFixMe,
    res: $TSFixMe
) {
    try {
        const { monitorIds, scanning } = req.body;
        await MonitorService.updateScanStatus(monitorIds, scanning);

        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/add-probe-scan', isAuthorizedProbe, async function (
    req: $TSFixMe,
    res: $TSFixMe
) {
    try {
        const { monitorIds } = req.body;
        await MonitorService.addProbeScanning(monitorIds, req.probe.id);

        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/remove-probe-scan', isAuthorizedProbe, async function (
    req: $TSFixMe,
    res: $TSFixMe
) {
    try {
        const { monitorIds } = req.body;
        await MonitorService.removeProbeScanning(monitorIds, req.probe.id);

        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
