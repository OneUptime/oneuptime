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

router.post('/', isAuthorizedAdmin, async function (req, res) {
    let data = req.body;
    try {
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
        return sendListResponse(req, res, probe,count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:id', isAuthorizedAdmin, async function (req, res) {
    let data = req.body;
    data._id = req.params.id;
    try {
        let probe = await ProbeService.update({_id:req.params.id},data);
        return sendItemResponse(req, res, probe);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:id', isAuthorizedAdmin, async function (req, res) {
    try {
        let probe = await ProbeService.deleteBy({_id:req.params.id});
        return sendItemResponse(req, res, probe);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/monitors', isAuthorizedProbe, async function (req, res) {
    try {
        let monitors = await MonitorService.getProbeMonitors(new Date(new Date().getTime() - (60 * 1000)));
        return sendListResponse(req, res, monitors,monitors.length);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/setTime/:monitorId', isAuthorizedProbe, async function (req, res) {
    let data = req.body;
    data.probeId = req.probe.id;
    data.monitorId = req.params.monitorId;
    try {
        let probe = await ProbeService.setTime(data);
        return sendItemResponse(req, res, probe);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/getTime/:monitorId', isAuthorizedProbe, async function (req, res) {
    let data = req.body;
    data.probeId = req.probe.id;
    data.monitorId = req.params.monitorId;
    try {
        let probe = await ProbeService.getTime(data);
        return sendItemResponse(req, res, probe);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});
module.exports = router;