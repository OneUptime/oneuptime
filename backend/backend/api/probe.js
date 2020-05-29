/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const ProbeService = require('../services/probeService');
const MonitorService = require('../services/monitorService');
const router = express.Router();
const isAuthorizedAdmin = require('../middlewares/clusterAuthorization')
    .isAuthorizedAdmin;
const isAuthorizedProbe = require('../middlewares/probeAuthorization')
    .isAuthorizedProbe;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendEmptyResponse = require('../middlewares/response').sendEmptyResponse;
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');

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
        const probe = await ProbeService.findBy({}, limit, skip);
        const count = await ProbeService.countBy({});
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

router.get('/monitors', isAuthorizedProbe, async function(req, res) {
    try {
        const monitors = await MonitorService.getProbeMonitors(
            new Date(new Date().getTime() - 60 * 1000)
        );
        return sendListResponse(req, res, monitors, monitors.length);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/ping/:monitorId', isAuthorizedProbe, async function(
    req,
    response
) {
    try {
        const { monitor, res, resp, type } = req.body;
        let status;

        if (type === 'api' || type === 'url') {
            const validUp = await (monitor &&
            monitor.criteria &&
            monitor.criteria.up
                ? ProbeService.conditions(res, resp, monitor.criteria.up)
                : false);
            const validDegraded = await (monitor &&
            monitor.criteria &&
            monitor.criteria.degraded
                ? ProbeService.conditions(res, resp, monitor.criteria.degraded)
                : false);
            const validDown = await (monitor &&
            monitor.criteria &&
            monitor.criteria.down
                ? ProbeService.conditions(res, resp, monitor.criteria.down)
                : false);

            if (validDown) {
                status = 'offline';
            } else if (validDegraded) {
                status = 'degraded';
            } else if (validUp) {
                status = 'online';
            } else {
                status = 'unknown';
            }
        }

        if (type === 'device') {
            if (res) {
                status = 'online';
            } else {
                status = 'offline';
            }
        }

        const data = req.body;
        data.responseTime = res || 0;
        data.responseStatus = resp && resp.status ? resp.status : null;
        data.status = status;
        data.probeId = req.probe && req.probe.id ? req.probe.id : null;
        data.monitorId = req.params.monitorId;
        data.sslCertificate =
            resp && resp.sslCertificate ? resp.sslCertificate : null;
        data.lighthouseScanStatus =
            resp && resp.lighthouseScanStatus
                ? resp.lighthouseScanStatus
                : null;
        data.lighthouseScores =
            resp && resp.lighthouseScores ? resp.lighthouseScores : null;

        if (data.lighthouseScanStatus) {
            await ProbeService.saveLighthouseScan(data);
        }
        if (!data.lighthouseScores) {
            const log = await ProbeService.saveMonitorLog(data);
            return sendItemResponse(req, response, log);
        }
        return sendEmptyResponse(req, response);
    } catch (error) {
        return sendErrorResponse(req, response, error);
    }
});

router.post('/setTime/:monitorId', isAuthorizedProbe, async function(req, res) {
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

router.post('/getTime/:monitorId', isAuthorizedProbe, async function(req, res) {
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

router.get('/:projectId/probes', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const limit = req.query.limit || null;
        const skip = req.query.skip || null;
        const probe = await ProbeService.findBy({}, limit, skip);
        const count = await ProbeService.countBy({});
        return sendListResponse(req, res, probe, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
