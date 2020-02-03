/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */


var express = require('express');
var SubscriberAlertService = require('../services/subscriberAlertService');
var path = require('path');
var fs = require('fs');

var router = express.Router();


var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendListResponse = require('../middlewares/response').sendListResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId/:subscriberId', async (req, res)=>{
    
    try {
        let data = req.body;
        data.projectId = req.params.projectId;
        data.subscriberId = req.params.subscriberId;
    
        if(!data.incidentId){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'IncidentId must be present'
            });
        }
    
        if(!data.alertVia){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'AlertVia must be present'
            });
        }
        let subscriberAlert = await SubscriberAlertService.create(data);
        return sendItemResponse(req, res, subscriberAlert);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }


});

// Mark alert as viewed
router.get('/:projectId/:alertId/viewed', async function (req, res) {
    try {
        const alertId = req.params.alertId;
        const projectId = req.params.projectId;

        await SubscriberAlertService.updateOneBy({ _id: alertId, projectId: projectId }, {alertStatus: 'Viewed'});
        var filePath = path.join(__dirname, '..', '..', 'views', 'img', 'Fyipe-Logo.png');
        var img = fs.readFileSync(filePath);

        res.set('Content-Type', 'image/png');
        res.status(200);
        res.end(img, 'binary');
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

// get subscribers alerts by projectId
// req.params-> {projectId};
// Returns: response subscriber alerts, error message
router.get('/:projectId', async (req, res) => {
    try {
        let projectId = req.params.projectId;
        let skip = req.query.skip || 0;
        let limit = req.query.limit || 10;
        let subscriberAlerts = await SubscriberAlertService.findBy({projectId: projectId}, skip, limit);
        let count = await SubscriberAlertService.countBy({projectId: projectId});
        return sendListResponse(req, res, subscriberAlerts, count);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

//get subscribers by incidentId
// req.params-> {projectId, incidentId};
// Returns: response subscriber alerts, error message
router.get('/:projectId/incident/:incidentId', async (req, res) => {
    try {
        var projectId = req.params.projectId;
        var incidentId = req.params.incidentId;
        var skip = req.query.skip || 0;
        var limit = req.query.limit || 10;
        var subscriberAlerts = await SubscriberAlertService.findBy({incidentId: incidentId, projectId: projectId }, skip, limit);
        var count = await SubscriberAlertService.countBy({incidentId: incidentId, projectId: projectId});
        return sendListResponse(req, res, subscriberAlerts, count);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;