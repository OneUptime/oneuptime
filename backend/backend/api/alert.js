/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

const express = require('express');
const alertService = require('../services/alertService');
const alertChargeService = require('../services/alertChargeService');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const {
    isAuthorized
} = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;
const isUserOwner = require('../middlewares/project').isUserOwner;

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        const projectId = req.params.projectId;
        const userId = req.user.id;
        const data = req.body;
        data.projectId = projectId;
        const alert = await alertService.create({projectId, monitorId: data.monitorId, alertVia: data.alertVia, userId: userId, incidentId: data.incidentId});
        return sendItemResponse(req, res, alert);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

// Fetch alerts by projectId
router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function (req, res) {
    try {
        const subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        const alerts = await alertService.getSubProjectAlerts(subProjectIds);
        return sendItemResponse(req, res, alerts); // frontend expects sendItemResponse
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/alert', getUser, isAuthorized, async function (req, res) {
    try {
        const projectId = req.params.projectId;
        const alerts = await alertService.findBy({query: { projectId }, skip: req.query.skip || 0, limit: req.query.limit || 10});
        const count = await alertService.countBy({ projectId });
        return sendListResponse(req, res, alerts, count); // frontend expects sendListResponse
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/incident/:incidentId', getUser, isAuthorized, async function (req, res) {
    try {
        const incidentId = req.params.incidentId;
        const skip = req.query.skip || 0;
        const limit = req.query.limit || 10;
        const alerts = await alertService.findBy({query: {incidentId:incidentId }, skip, limit});
        const count = await alertService.countBy({incidentId: incidentId});
        return sendListResponse(req, res, alerts,  count);
    } catch(error) {
        return sendErrorResponse( req, res, error);
    }
});

// Mark alert as viewed. This is for Email.
router.get('/:projectId/:alertId/viewed', async function (req, res) {
    try {
        const alertId = req.params.alertId;
        const projectId = req.params.projectId;
        await alertService.updateOneBy({ _id: alertId, projectId: projectId }, {alertStatus: 'Viewed'});
        const filePath = path.join(__dirname, '..', '..', 'views', 'img', 'Fyipe-Logo.png');
        const img = fs.readFileSync(filePath);

        res.set('Content-Type', 'image/png');
        res.status(200);
        res.end(img, 'binary');
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId', getUser, isUserOwner, async function(req, res){
    try {
        const projectId = req.params.projectId;
        const userId = req.user.id;
        const alert = await alertService.deleteBy({projectId: projectId}, userId);
        return sendItemResponse(req, res, alert);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/alert/charges', getUser, isAuthorized, async function(req, res) {
    try {
        const projectId = req.params.projectId;
        const alertCharges = await alertChargeService.findBy({ projectId }, req.query.skip , req.query.limit );
        const count = await alertChargeService.countBy({ projectId });
        return sendListResponse(req, res, alertCharges, count);
    } catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;