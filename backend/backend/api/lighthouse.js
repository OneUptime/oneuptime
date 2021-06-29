/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const LighthouseService = require('../services/LighthouseService');
const ProbeService = require('../services/ProbeService');
const MonitorService = require('../services/monitorService');
const ProjectService = require('../services/projectService');
const LighthouseLogService = require('../services/lighthouseLogService');
const router = express.Router();
const isAuthorizedAdmin = require('../middlewares/clusterAuthorization')
    .isAuthorizedAdmin;

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const storage = require('../middlewares/upload');
const { isAuthorizedLighthouse } = require('../middlewares/lighthouseAuthorization');


router.post('/', getUser, isAuthorizedAdmin, async function (req, res) {
    try {
        const data = req.body;
        const lighthouse = await LighthouseService.create(data);
        return sendItemResponse(req, res, lighthouse);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/', getUser, isAuthorizedAdmin, async function (req, res) {
    try {
        const skip = req.query.skip || 0;
        const limit = req.query.limit || 0;
        const lighthouse = await LighthouseService.findBy({}, limit, skip);
        const count = await LighthouseService.countBy({});
        return sendListResponse(req, res, lighthouse, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:id', getUser, isAuthorizedAdmin, async function (req, res) {
    try {
        const data = req.body;
        const lighthouse = await LighthouseService.updateOneBy(
            { _id: req.params.id },
            data
        );
        return sendItemResponse(req, res, lighthouse);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:id', getUser, isAuthorizedAdmin, async function (req, res) {
    try {
        const lighthouse = await LighthouseService.deleteBy({ _id: req.params.id });
        return sendItemResponse(req, res, lighthouse);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Updating profile setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic};
// Returns: 200: Success, 400: Error; 500: Server Error.

router.get('/monitors', isAuthorizedLighthouse, async function (req, res) {
    try {
        const monitors = await MonitorService.getUrlMonitors(
            req.lighthouse.id,
            new Date(new Date().getTime() - 60 * 1000)
        );
        console.log("Get Lighthouse Monitors: ", monitors);
        //Update the lastAlive in the lighthouse servers list located in the status pages.
        if (monitors.length > 0) {
            const projectIds = {};
            for (const monitor of monitors) {
                const project = await ProjectService.findOneBy({
                    _id: monitor.projectId,
                });
                const projectId = project
                    ? project.parentProjectId
                        ? project.parentProjectId._id
                        : project._id
                    : monitor.projectId;
                projectIds[projectId] = true;
            }
            for (const projectId of Object.keys(projectIds)) {
                const lighthouse = await LighthouseService.findOneBy({
                    _id: req.lighthouse.id,
                });
                global.io.emit(`updatelighthouse-${projectId}`, lighthouse);
            }
        }
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

router.post('/ping/:monitorId', isAuthorizedLighthouse, async function (
    req,
    response
) {
    // let release;
    try {
        console.log("Pinging :", req.body);
        console.log("Pinging 3 :", req.lighthouse);
        const {
            monitor,
            res,
            resp,
            rawResp,
            type,
            retryCount,
        } = req.body;

        let status,
            log,
            reason,
            data = {};
        let matchedCriterion;

        if (type === 'url') {
            const {
                stat: validUp,
                successReasons: upSuccessReasons,
                failedReasons: upFailedReasons,
                matchedCriterion: matchedUpCriterion,
            } = await (monitor && monitor.criteria && monitor.criteria.up
                ? ProbeService.conditions(
                    monitor.type,
                    monitor.criteria.up,
                    res,
                    resp,
                    rawResp
                )
                : { stat: false, successReasons: [], failedReasons: [] });
            const {
                stat: validDegraded,
                successReasons: degradedSuccessReasons,
                failedReasons: degradedFailedReasons,
                matchedCriterion: matchedDegradedCriterion,
            } = await (monitor &&
                monitor.criteria &&
                monitor.criteria.degraded
                ? ProbeService.conditions(
                    monitor.type,
                    monitor.criteria.degraded,
                    res,
                    resp,
                    rawResp
                )
                : { stat: false, successReasons: [], failedReasons: [] });
            const {
                stat: validDown,
                successReasons: downSuccessReasons,
                failedReasons: downFailedReasons,
                matchedCriterion: matchedDownCriterion,
            } = await (monitor && monitor.criteria && monitor.criteria.down
                ? ProbeService.conditions(
                    monitor.type,
                    [
                        ...monitor.criteria.down.filter(
                            criterion => criterion.default !== true
                        ),
                    ],
                    res,
                    resp,
                    rawResp
                )
                : { stat: false, successReasons: [], failedReasons: [] });

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
                        criterion => criterion.default === true
                    );
                }
            }
            data.status = status;
            data.reason = reason;
        }

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


        data.matchedCriterion = matchedCriterion;
        console.log("Data before monitor update: ", data);
        // update monitor to save the last matched criterion
        await MonitorService.updateOneBy(
            {
                _id: monitor._id,
            },
            {
                lastMatchedCriterion: matchedCriterion,
            }
        );
        data.monitorId = req.params.monitorId || monitor._id;
        data.lighthouseId = req.lighthouse && req.lighthouse.id ? req.lighthouse.id : null;
        data.reason =
            data && data.reason && data.reason.length
                ? data.reason.filter(
                    (item, pos, self) => self.indexOf(item) === pos
                )
                : data.reason;
        const index =
            data.reason && data.reason.indexOf('Request Timed out');
        if (index > -1) {
            data.reason =
                data && data.reason && data.reason.length
                    ? data.reason.filter(
                        item => !item.includes('Response Time is')
                    )
                    : data.reason;
        }
        console.log("Data Lighthouse update: ", data);
        if (data.lighthouseScanStatus) {
            if (data.lighthouseScanStatus === 'scanning') {
                await MonitorService.updateOneBy(
                    { _id: data.monitorId },
                    {
                        lighthouseScanStatus: data.lighthouseScanStatus,
                    },
                    { fetchLightHouse: true }
                );
                await LighthouseLogService.updateAllLighthouseLogs(
                    data.monitor.projectId,
                    data.monitorId,
                    { scanning: true }
                );
            } else {
                await MonitorService.updateOneBy(
                    { _id: data.monitorId },
                    {
                        lighthouseScannedAt: Date.now(),
                        lighthouseScanStatus: data.lighthouseScanStatus, // scanned || failed
                        lighthouseScannedBy: data.lighthouseId,
                    }
                );
            }
        } else {
            if (data.lighthouseData) {
                data.scanning = false;
                log = await LighthouseService.saveLighthouseLog(data);
            } else {
                data.matchedUpCriterion =
                    monitor && monitor.criteria && monitor.criteria.up;
                data.matchedDownCriterion =
                    monitor && monitor.criteria && monitor.criteria.down;
                data.matchedDegradedCriterion =
                    monitor &&
                    monitor.criteria &&
                    monitor.criteria.degraded;

                log = await LighthouseService.saveMonitorLog(data);
            }
        }
        console.log("Sent Log: ", log);
        console.log("Sent Response: ", response);
        console.log("Sent Response: ", req);
        return sendItemResponse(req, response, log);
    } catch (error) {
        return sendErrorResponse(req, response, error);
    } finally {
        // if (release) {
        //     release();
        // }
    }
});

module.exports = router;
