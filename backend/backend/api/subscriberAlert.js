/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */


let express = require('express');
let SubscriberAlertService = require('../services/subscriberAlertService');
let path = require('path');
let fs = require('fs');

let router = express.Router();


let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendListResponse = require('../middlewares/response').sendListResponse;
let sendItemResponse = require('../middlewares/response').sendItemResponse;

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
        let filePath = path.join(__dirname, '..', '..', 'views', 'img', 'Fyipe-Logo.png');
        let img = fs.readFileSync(filePath);

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
        let projectId = req.params.projectId;
        let incidentId = req.params.incidentId;
        let skip = req.query.skip || 0;
        let limit = req.query.limit || 10;
        let subscriberAlerts = await SubscriberAlertService.findBy({incidentId: incidentId, projectId: projectId }, skip, limit);
        let count = await SubscriberAlertService.countBy({incidentId: incidentId, projectId: projectId});
        return sendListResponse(req, res, subscriberAlerts, count);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;