import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
import ProbeService from '../Services/probeService';
import MonitorService from '../Services/monitorService';
import LighthouseLogService from '../Services/lighthouseLogService';
const router: ExpressRouter = Express.getRouter();
import { isAuthorizedProbe } from '../middlewares/probeAuthorization';
import {
    sendErrorResponse,
    sendItemResponse,
    sendEmptyResponse,
} from 'CommonServer/utils/Response';
import Exception from 'Common/Types/Exception/Exception';

import { ObjectId } from 'mongodb';

router.post(
    '/ping/:monitorId',
    isAuthorizedProbe,
    async (req: ExpressRequest, response: ExpressResponse): void => {
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
            const { monitorId }: $TSFixMe = req.params;

            let status: $TSFixMe,
                log: $TSFixMe,
                reason: $TSFixMe,
                data: $TSFixMe = {};
            let matchedCriterion: $TSFixMe;

            if (type === 'incomingHttpRequest') {
                const newMonitor: $TSFixMe = MonitorService.findOneBy({
                    query: { _id: ObjectId(monitor._id) },
                });

                const probeId: $TSFixMe =
                    req.probe && req.probe.id ? req.probe.id : null;
                log = ProbeService.probeHttpRequest(newMonitor, probeId);
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

                        // FailedReasons: degradedFailedReasons,
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

                        // FailedReasons: downFailedReasons,
                        matchedCriterion: matchedDownCriterion,
                    }: $TSFixMe = monitor &&
                    monitor.criteria &&
                    monitor.criteria.down
                        ? ProbeService.conditions(
                              monitor.type,
                              [
                                  ...monitor.criteria.down.filter(
                                      (criterion: $TSFixMe) => {
                                          return criterion.default !== true;
                                      }
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

                    const [up, degraded, down]: $TSFixMe = await Promise.all([
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
                                (criterion: $TSFixMe) => {
                                    return criterion.default === true;
                                }
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
                                      (criterion: $TSFixMe) => {
                                          return criterion.default !== true;
                                      }
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
                                (criterion: $TSFixMe) => {
                                    return criterion.default === true;
                                }
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
                                  (criterion: $TSFixMe) => {
                                      return criterion.default !== true;
                                  }
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
                                (criterion: $TSFixMe) => {
                                    return criterion.default === true;
                                }
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
                                      (criterion: $TSFixMe) => {
                                          return criterion.default !== true;
                                      }
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
                                (criterion: $TSFixMe) => {
                                    return criterion.default === true;
                                }
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
                                      (criterion: $TSFixMe) => {
                                          return criterion.default !== true;
                                      }
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
                                (criterion: $TSFixMe) => {
                                    return criterion.default === true;
                                }
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
                // Update monitor to save the last matched criterion
                MonitorService.updateCriterion(monitor._id, matchedCriterion);

                data.monitorId = monitorId || monitor._id;

                data.probeId = req.probe && req.probe.id ? req.probe.id : null;

                data.reason =
                    data && data.reason && data.reason.length
                        ? data.reason.filter(
                              (
                                  item: $TSFixMe,
                                  pos: $TSFixMe,
                                  self: $TSFixMe
                              ) => {
                                  return self.indexOf(item) === pos;
                              }
                          )
                        : data.reason;
                const index: $TSFixMe =
                    data.reason && data.reason.indexOf('Request Timed out');
                if (index > -1) {
                    data.reason =
                        data && data.reason && data.reason.length
                            ? data.reason.filter((item: $TSFixMe) => {
                                  return !item.includes('Response Time is');
                              })
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
                        // When this is scanned success or failed.
                        MonitorService.updateLighthouseScanStatus(
                            data.monitorId,

                            data.lighthouseScanStatus,

                            data.probeId
                        );
                    }
                } else if (data.lighthouseData) {
                    data.scanning = false;
                    log = ProbeService.saveLighthouseLog(data);
                } else {
                    data.matchedUpCriterion =
                        monitor && monitor.criteria && monitor.criteria.up;

                    data.matchedDownCriterion =
                        monitor && monitor.criteria && monitor.criteria.down;

                    data.matchedDegradedCriterion =
                        monitor &&
                        monitor.criteria &&
                        monitor.criteria.degraded;

                    log = ProbeService.saveMonitorLog(data);

                    if (type === 'script') {
                        MonitorService.updateScriptStatus(
                            monitorId,
                            'completed',
                            req.probe.id
                        );
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
            const data: $TSFixMe = req.body;
            data.probeId = req.probe.id;
            data.monitorId = req.params['monitorId'];
            const log: $TSFixMe = ProbeService.saveMonitorLog(data);
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
            const data: $TSFixMe = req.body;
            data.probeId = req.probe.id;
            data.monitorId = req.params['monitorId'];
            const log: $TSFixMe = ProbeService.getMonitorLog(data);
            return sendItemResponse(req, res, log);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/set-scan-status',
    isAuthorizedProbe,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { monitorIds, scanning }: $TSFixMe = req.body;
            MonitorService.updateScanStatus(monitorIds, scanning);

            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/add-probe-scan',
    isAuthorizedProbe,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { monitorIds }: $TSFixMe = req.body;
            MonitorService.addProbeScanning(monitorIds, req.probe.id);

            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/remove-probe-scan',
    isAuthorizedProbe,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { monitorIds }: $TSFixMe = req.body;
            MonitorService.removeProbeScanning(monitorIds, req.probe.id);

            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
