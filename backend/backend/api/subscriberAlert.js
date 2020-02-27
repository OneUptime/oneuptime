/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const SubscriberAlertService = require('../services/subscriberAlertService');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId/:subscriberId', async (req, res) => {
    try {
        const data = req.body;
        data.projectId = req.params.projectId;
        data.subscriberId = req.params.subscriberId;

        if (!data.incidentId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'IncidentId must be present',
            });
        }

        if (!data.alertVia) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'AlertVia must be present',
            });
        }
        const subscriberAlert = await SubscriberAlertService.create(data);
        return sendItemResponse(req, res, subscriberAlert);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Mark alert as viewed
router.get('/:projectId/:alertId/viewed', async function(req, res) {
    try {
        const alertId = req.params.alertId;
        const projectId = req.params.projectId;

        await SubscriberAlertService.updateOneBy(
            { _id: alertId, projectId: projectId },
            { alertStatus: 'Viewed' }
        );
        const filePath = path.join(
            __dirname,
            '..',
            '..',
            'views',
            'img',
            'Fyipe-Logo.png'
        );
        const img = fs.readFileSync(filePath);

        res.set('Content-Type', 'image/png');
        res.status(200);
        res.end(img, 'binary');
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// get subscribers alerts by projectId
// req.params-> {projectId};
// Returns: response subscriber alerts, error message
router.get('/:projectId', async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const skip = req.query.skip || 0;
        const limit = req.query.limit || 10;
        const subscriberAlerts = await SubscriberAlertService.findBy(
            { projectId: projectId },
            skip,
            limit
        );
        const count = await SubscriberAlertService.countBy({
            projectId: projectId,
        });
        return sendListResponse(req, res, subscriberAlerts, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

//get subscribers by incidentId
// req.params-> {projectId, incidentId};
// Returns: response subscriber alerts, error message
router.get('/:projectId/incident/:incidentId', async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const incidentId = req.params.incidentId;
        const skip = req.query.skip || 0;
        const limit = req.query.limit || 10;
        const subscriberAlerts = await SubscriberAlertService.findBy(
            { incidentId: incidentId, projectId: projectId },
            skip,
            limit
        );
        const count = await SubscriberAlertService.countBy({
            incidentId: incidentId,
            projectId: projectId,
        });
        return sendListResponse(req, res, subscriberAlerts, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
