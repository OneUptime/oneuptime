/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const ProbeService = require('../services/probeService');
const MonitorService = require('../services/monitorService');
const router = express.Router();
const isAuthorizedAdmin = require('../middlewares/clusterAuthorization').isAuthorizedAdmin;
const isAuthorizedProbe = require('../middlewares/probeAuthorization').isAuthorizedProbe;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
var getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');

router.post('/', isAuthorizedAdmin, async function (req, res) {
    try {
        let data = req.body;
        let probe = await ProbeService.create(data);
        return sendItemResponse(req, res, probe);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/', isAuthorizedAdmin, async function (req, res) {
    try {
        let probe = await ProbeService.findBy({});
        let count = await ProbeService.countBy({});
        return sendListResponse(req, res, probe, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:id', isAuthorizedAdmin, async function (req, res) {
    try {
        let data = req.body;
        let probe = await ProbeService.updateOneBy({ _id: req.params.id }, data);
        return sendItemResponse(req, res, probe);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:id', isAuthorizedAdmin, async function (req, res) {
    try {
        let probe = await ProbeService.deleteBy({ _id: req.params.id });
        return sendItemResponse(req, res, probe);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/monitors', isAuthorizedProbe, async function (req, res) {
    try {
        let monitors = await MonitorService.getProbeMonitors(new Date(new Date().getTime() - (60 * 1000)));
        return sendListResponse(req, res, monitors, monitors.length);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/ping/:monitorId', isAuthorizedProbe, async function (req, response) {
    try {
        const { monitor, res, resp, type } = req.body;
        let status;

        if (type === 'api' || type === 'url') {
            let validUp = await (monitor && monitor.criteria && monitor.criteria.up ? ProbeService.conditions(res, resp, monitor.criteria.up) : false);
            let validDegraded = await (monitor && monitor.criteria && monitor.criteria.degraded ? ProbeService.conditions(res, resp, monitor.criteria.degraded) : false);
            let validDown = await (monitor && monitor.criteria && monitor.criteria.down ? ProbeService.conditions(res, resp, monitor.criteria.down) : false);

            if (validDown) {
                status = 'offline';
            } else if (validDegraded) {
                status = 'degraded';
            } else {
                status = 'online';
            }
        }

        if (type === 'device') {
            if (res) {
                status = 'online';
            } else {
                status = 'offline';
            }
        }

        let data = req.body;
        data.responseTime = res || 0;
        data.responseStatus = resp && resp.status ? resp.status : null;
        data.status = status;
        data.probeId = req.probe && req.probe.id ? req.probe.id : null;
        data.monitorId = req.params.monitorId;
        let probe = await ProbeService.setTime(data);
        return sendItemResponse(req, response, probe);
    } catch (error) {
        return sendErrorResponse(req, response, error);
    }
});

router.post('/setTime/:monitorId', isAuthorizedProbe, async function (req, res) {
    try {
        let data = req.body;
        data.probeId = req.probe.id;
        data.monitorId = req.params.monitorId;
        let probe = await ProbeService.setTime(data);
        return sendItemResponse(req, res, probe);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/getTime/:monitorId', isAuthorizedProbe, async function (req, res) {
    try {
        let data = req.body;
        data.probeId = req.probe.id;
        data.monitorId = req.params.monitorId;
        let probe = await ProbeService.getTime(data);
        return sendItemResponse(req, res, probe);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/probes', getUser, isAuthorized, async function (req, res) {
    try {
        var limit = req.query.limit || null;
        var skip = req.query.skip || null;
        let probe = await ProbeService.findBy({}, limit, skip);
        let count = await ProbeService.countBy({});
        return sendListResponse(req, res, probe, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;