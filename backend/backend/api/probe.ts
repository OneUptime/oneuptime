import express from 'express';
import ProbeService from '../services/probeService';
import MonitorService from '../services/monitorService';
import LighthouseLogService from '../services/lighthouseLogService';
const router = express.Router();
const isAuthorizedAdmin = require('../middlewares/clusterAuthorization')
    .isAuthorizedAdmin;
const isAuthorizedProbe = require('../middlewares/probeAuthorization')
    .isAuthorizedProbe;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const getUser = require('../middlewares/user').getUser;
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/authorization"' has no exp... Remove this comment to see the full error message
import { isAuthorized } from '../middlewares/authorization';
import multer from 'multer';
import storage from '../middlewares/upload';

router.post('/', getUser, isAuthorizedAdmin, async function(req, res) {
    try {
        const data = req.body;
        const probe = await ProbeService.create(data);
        return sendItemResponse(req, res, probe);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/', getUser, isAuthorizedAdmin, async function(req, res) {
    try {
        const skip = req.query.skip || 0;
        const limit = req.query.limit || 0;
        const selectProbe =
            'createdAt probeKey probeName version lastAlive deleted deletedAt probeImage';
        const [probe, count] = await Promise.all([
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: {}; limit: string | num... Remove this comment to see the full error message
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
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:id', getUser, isAuthorizedAdmin, async function(req, res) {
    try {
        const data = req.body;
        const probe = await ProbeService.updateOneBy(
            { _id: req.params.id },
            data
        );
        return sendItemResponse(req, res, probe);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:id', getUser, isAuthorizedAdmin, async function(req, res) {
    try {
        const probe = await ProbeService.deleteBy({ _id: req.params.id });
        return sendItemResponse(req, res, probe);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Updating profile setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic};
// Returns: 200: Success, 400: Error; 500: Server Error.

router.put('/update/image', getUser, async function(req, res) {
    try {
        const upload = multer({
            storage,
        }).fields([
            {
                name: 'probeImage',
                maxCount: 1,
            },
        ]);
        upload(req, res, async function(error: $TSFixMe) {
            const probeId = req.body.id;
            const data = req.body;

            if (error) {
                return sendErrorResponse(req, res, error);
            }
            if (
                req.files &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeImage' does not exist on type '{ [f... Remove this comment to see the full error message
                req.files.probeImage &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeImage' does not exist on type '{ [f... Remove this comment to see the full error message
                req.files.probeImage[0].filename
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeImage' does not exist on type '{ [f... Remove this comment to see the full error message
                data.probeImage = req.files.probeImage[0].filename;
            }

            // Call the ProbeService
            const save = await ProbeService.updateOneBy({ _id: probeId }, data);
            return sendItemResponse(req, res, save);
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/monitors', isAuthorizedProbe, async function(req, res) {
    try {
        const monitors = await MonitorService.getProbeMonitors(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probe' does not exist on type 'Request<{... Remove this comment to see the full error message
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
        return sendErrorResponse(req, res, error);
    }
});

router.post('/ping/:monitorId', isAuthorizedProbe, async function(
    req,
    response
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
                query: { _id: monitor._id },
                select: 'lastPingTime _id criteria',
            });

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probe' does not exist on type 'Request<{... Remove this comment to see the full error message
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
                    failedReasons: degradedFailedReasons,
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
                } else if (validDegraded) {
                    status = 'degraded';
                    reason = [...degradedSuccessReasons, ...upFailedReasons];
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
                            (criterion: $TSFixMe) => criterion.default === true
                        );
                    }
                }
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
                data.status = status;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
                data.status = status;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
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

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
                data.status = status;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
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
                        ? // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 3.
                          ProbeService.conditions(
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
                        ? // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 3.
                          ProbeService.conditions(
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
                        ? // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 3.
                          ProbeService.conditions(
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
                    data.status = 'online';
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                    data.reason = upSuccessReasons;
                    matchedCriterion = matchedUpCriterion;
                } else if (validDegraded) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
                    data.status = 'degraded';
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                    data.reason = [
                        ...degradedSuccessReasons,
                        ...upFailedReasons,
                    ];
                    matchedCriterion = matchedDegradedCriterion;
                } else if (validDown) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
                    data.status = 'offline';
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                    data.reason = [
                        ...downSuccessReasons,
                        ...degradedFailedReasons,
                        ...upFailedReasons,
                    ];
                    matchedCriterion = matchedDownCriterion;
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
                    data.status = 'offline';
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseTime' does not exist on type '{}... Remove this comment to see the full error message
                data.responseTime = res || 0;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseStatus' does not exist on type '... Remove this comment to see the full error message
                data.responseStatus = resp && resp.status ? resp.status : null;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
                data.status = status;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'sslCertificate' does not exist on type '... Remove this comment to see the full error message
                data.sslCertificate =
                    resp && resp.sslCertificate ? resp.sslCertificate : null;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseScanStatus' does not exist on ... Remove this comment to see the full error message
                data.lighthouseScanStatus =
                    resp && resp.lighthouseScanStatus
                        ? resp.lighthouseScanStatus
                        : null;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'performance' does not exist on type '{}'... Remove this comment to see the full error message
                data.performance =
                    resp && resp.performance ? resp.performance : null;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'accessibility' does not exist on type '{... Remove this comment to see the full error message
                data.accessibility =
                    resp && resp.accessibility ? resp.accessibility : null;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'bestPractices' does not exist on type '{... Remove this comment to see the full error message
                data.bestPractices =
                    resp && resp.bestPractices ? resp.bestPractices : null;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'seo' does not exist on type '{}'.
                data.seo = resp && resp.seo ? resp.seo : null;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'pwa' does not exist on type '{}'.
                data.pwa = resp && resp.pwa ? resp.pwa : null;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseData' does not exist on type '... Remove this comment to see the full error message
                data.lighthouseData =
                    resp && resp.lighthouseData ? resp.lighthouseData : null;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'retryCount' does not exist on type '{}'.
                data.retryCount = retryCount || 0;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                data.reason = reason;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'response' does not exist on type '{}'.
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
                        ? // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 3.
                          ProbeService.conditions(
                              monitor.type,
                              monitor.criteria.up,
                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesData' does not exist on type '... Remove this comment to see the full error message
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
                        ? // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 3.
                          ProbeService.conditions(
                              monitor.type,
                              monitor.criteria.degraded,
                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesData' does not exist on type '... Remove this comment to see the full error message
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
                        ? // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 3.
                          ProbeService.conditions(
                              monitor.type,
                              [
                                  ...monitor.criteria.down.filter(
                                      (criterion: $TSFixMe) =>
                                          criterion.default !== true
                                  ),
                              ],
                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesData' does not exist on type '... Remove this comment to see the full error message
                              data.kubernetesData
                          )
                        : {
                              stat: false,
                              successReasons: [],
                              failedReasons: [],
                          };

                if (validUp) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
                    data.status = 'online';
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                    data.reason = upSuccessReasons;
                    matchedCriterion = matchedUpCriterion;
                } else if (validDegraded) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
                    data.status = 'degraded';
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                    data.reason = [
                        ...degradedSuccessReasons,
                        ...upFailedReasons,
                    ];
                    matchedCriterion = matchedDegradedCriterion;
                } else if (validDown) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
                    data.status = 'offline';
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                    data.reason = [
                        ...downSuccessReasons,
                        ...degradedFailedReasons,
                        ...upFailedReasons,
                    ];
                    matchedCriterion = matchedDownCriterion;
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
                    data.status = 'offline';
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'scriptMetadata' does not exist on type '... Remove this comment to see the full error message
                data.scriptMetadata = {
                    executionTime: resp.executionTime,
                    consoleLogs: resp.consoleLogs,
                    error: resp.error,
                    statusText: resp.statusText,
                };
            }

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'matchedCriterion' does not exist on type... Remove this comment to see the full error message
            data.matchedCriterion = matchedCriterion;
            // update monitor to save the last matched criterion

            await MonitorService.updateCriterion(monitor._id, matchedCriterion);

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
            data.monitorId = monitorId || monitor._id;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type '{}'.
            data.probeId = req.probe && req.probe.id ? req.probe.id : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
            data.reason =
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                data && data.reason && data.reason.length
                    ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                      data.reason.filter(
                          (item: $TSFixMe, pos: $TSFixMe, self: $TSFixMe) =>
                              self.indexOf(item) === pos
                      )
                    : // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                      data.reason;
            const index =
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                data.reason && data.reason.indexOf('Request Timed out');
            if (index > -1) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                data.reason =
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                    data && data.reason && data.reason.length
                        ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                          data.reason.filter(
                              (item: $TSFixMe) =>
                                  !item.includes('Response Time is')
                          )
                        : // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                          data.reason;
            }

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseScanStatus' does not exist on ... Remove this comment to see the full error message
            if (data.lighthouseScanStatus) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseScanStatus' does not exist on ... Remove this comment to see the full error message
                if (data.lighthouseScanStatus === 'scanning') {
                    await Promise.all([
                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                        MonitorService.updateLighthouseScanStatus(
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
                            data.monitorId,
                            'scanning'
                        ),
                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                        LighthouseLogService.updateAllLighthouseLogs(
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
                            data.monitorId,
                            { scanning: true }
                        ),
                    ]);
                } else {
                    // when this is scanned success or failed.
                    await MonitorService.updateLighthouseScanStatus(
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
                        data.monitorId,
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseScanStatus' does not exist on ... Remove this comment to see the full error message
                        data.lighthouseScanStatus,
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type '{}'.
                        data.probeId
                    );
                }
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseData' does not exist on type '... Remove this comment to see the full error message
                if (data.lighthouseData) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'scanning' does not exist on type '{}'.
                    data.scanning = false;
                    log = await ProbeService.saveLighthouseLog(data);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'matchedUpCriterion' does not exist on ty... Remove this comment to see the full error message
                    data.matchedUpCriterion =
                        monitor && monitor.criteria && monitor.criteria.up;
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'matchedDownCriterion' does not exist on ... Remove this comment to see the full error message
                    data.matchedDownCriterion =
                        monitor && monitor.criteria && monitor.criteria.down;
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'matchedDegradedCriterion' does not exist... Remove this comment to see the full error message
                    data.matchedDegradedCriterion =
                        monitor &&
                        monitor.criteria &&
                        monitor.criteria.degraded;

                    log = await ProbeService.saveMonitorLog(data);

                    if (type === 'script') {
                        await MonitorService.updateScriptStatus(
                            monitorId,
                            'completed',
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probe' does not exist on type 'Request<{... Remove this comment to see the full error message
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

router.post('/setTime/:monitorId', isAuthorizedProbe, async function(req, res) {
    try {
        const data = req.body;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probe' does not exist on type 'Request<{... Remove this comment to see the full error message
        data.probeId = req.probe.id;
        data.monitorId = req.params.monitorId;
        const log = await ProbeService.saveMonitorLog(data);
        return sendItemResponse(req, res, log);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/getTime/:monitorId', isAuthorizedProbe, async function(req, res) {
    try {
        const data = req.body;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probe' does not exist on type 'Request<{... Remove this comment to see the full error message
        data.probeId = req.probe.id;
        data.monitorId = req.params.monitorId;
        const log = await ProbeService.getMonitorLog(data);
        return sendItemResponse(req, res, log);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/probes', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const limit = req.query.limit || null;
        const skip = req.query.skip || null;
        const selectProbe =
            'createdAt probeKey probeName version lastAlive deleted deletedAt probeImage';
        const [probe, count] = await Promise.all([
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: {}; limit: string | Que... Remove this comment to see the full error message
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
        return sendErrorResponse(req, res, error);
    }
});

export default router;
