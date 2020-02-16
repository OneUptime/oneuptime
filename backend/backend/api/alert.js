/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

let express = require('express');
let alertService = require('../services/alertService');
let alertChargeService = require('../services/alertChargeService');
let path = require('path');
let fs = require('fs');

let router = express.Router();
const {
    isAuthorized
} = require('../middlewares/authorization');
let getUser = require('../middlewares/user').getUser;
let getSubProjects = require('../middlewares/subProject').getSubProjects;
let isUserOwner = require('../middlewares/project').isUserOwner;

let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendListResponse = require('../middlewares/response').sendListResponse;
let sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        let projectId = req.params.projectId;
        let userId = req.user.id;
        let data = req.body;
        data.projectId = projectId;
        let alert = await alertService.create({projectId, monitorId: data.monitorId, alertVia: data.alertVia, userId: userId, incidentId: data.incidentId});
        return sendItemResponse(req, res, alert);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

// Fetch alerts by projectId
router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function (req, res) {
    try {
        let subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        let alerts = await alertService.getSubProjectAlerts(subProjectIds);
        return sendItemResponse(req, res, alerts); // frontend expects sendItemResponse
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/alert', getUser, isAuthorized, async function (req, res) {
    try {
        let projectId = req.params.projectId;
        let alerts = await alertService.findBy({query: { projectId }, skip: req.query.skip || 0, limit: req.query.limit || 10});
        let count = await alertService.countBy({ projectId });
        return sendListResponse(req, res, alerts, count); // frontend expects sendListResponse
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/incident/:incidentId', getUser, isAuthorized, async function (req, res) {
    try {
        let incidentId = req.params.incidentId;
        let skip = req.query.skip || 0;
        let limit = req.query.limit || 10;
        let alerts = await alertService.findBy({query: {incidentId:incidentId }, skip, limit});
        let count = await alertService.countBy({incidentId: incidentId});
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
        let filePath = path.join(__dirname, '..', '..', 'views', 'img', 'Fyipe-Logo.png');
        let img = fs.readFileSync(filePath);

        res.set('Content-Type', 'image/png');
        res.status(200);
        res.end(img, 'binary');
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId', getUser, isUserOwner, async function(req, res){
    try {
        let projectId = req.params.projectId;
        let userId = req.user.id;
        let alert = await alertService.deleteBy({projectId: projectId}, userId);
        return sendItemResponse(req, res, alert);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/alert/charges', getUser, isAuthorized, async function(req, res) {
    try {
        let projectId = req.params.projectId;
        let alertCharges = await alertChargeService.findBy({ projectId }, req.query.skip , req.query.limit );
        let count = await alertChargeService.countBy({ projectId });
        return sendListResponse(req, res, alertCharges, count);
    } catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;