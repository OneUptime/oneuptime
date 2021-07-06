/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const ProbeService = require('../services/ProbeService');
const MonitorService = require('../services/monitorService');
const LighthouseLogService = require('../services/lighthouseLogService');
const router = express.Router();
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const { isAuthorizedLighthouse } = require('../middlewares/lighthouseAuthorization');


// Route
// Description: Updating profile setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic};
// Returns: 200: Success, 400: Error; 500: Server Error.

router.get('/monitors', isAuthorizedLighthouse, async function (req, res) {
    try {
        const monitors = await MonitorService.getUrlMonitors();

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
    try {
        const {
            monitor,
            resp,
        } = req.body;

        let log, data = {};

        data = req.body;
        data.lighthouseScanStatus =
            resp && (resp.lighthouseScanStatus)
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
        data.monitorId = req.params.monitorId || monitor._id;
        let probeId = await ProbeService.findBy();
        data.probeId = probeId ? probeId[0]._id : null;

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
                    lighthouseScannedBy: data.probeId,
                }
            );
            if (data.lighthouseData) { // The scanned results are published
                data.scanning = false;
                log = await ProbeService.saveLighthouseLog(data);
            }
        }
        return sendItemResponse(req, response, log);
    } catch (error) {
        return sendErrorResponse(req, response, error);
    }
});

module.exports = router;
