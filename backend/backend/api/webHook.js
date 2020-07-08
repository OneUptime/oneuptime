const express = require('express');
const IntegrationService = require('../services/integrationService');
const getUser = require('../middlewares/user').getUser;
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

const router = express.Router();

router.post('/:projectId/create', getUser, isUserAdmin, async function(
    req,
    res
) {
    try {
        const projectId = req.params.projectId;
        const body = req.body;
        const userId = req.user ? req.user.id : null;

        const monitorId = body.monitorId;
        const endpoint = body.endpoint;
        const endpointType = body.endpointType;
        const incidentCreated = body.incidentCreated;
        const incidentResolved = body.incidentResolved;
        const incidentAcknowledged = body.incidentAcknowledged;
        const integrationType = body.type;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'projectId missing in params, must be present',
            });
        }

        if (!endpoint) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'endpoint missing in body, must be present',
            });
        }

        if (!monitorId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'monitorId is missing in body, must be present',
            });
        }

        if (!integrationType) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'type is missing in body, it must be present',
            });
        }

        const existingWebhook = await IntegrationService.findOneBy({
            monitorId,
            'data.endpoint': endpoint,
            'data.endpointType': endpointType,
            deleted: { $ne: null },
        });
        if (existingWebhook) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'webhook with url and endpoint type exist.',
            });
        }

        const data = { userId, endpoint, endpointType, monitorId };
        const notificationOptions = {
            incidentCreated,
            incidentAcknowledged,
            incidentResolved,
        };

        const webhook = await IntegrationService.create(
            projectId,
            userId,
            data,
            integrationType,
            notificationOptions
        );
        return sendItemResponse(req, res, webhook);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// update webhook
router.put('/:projectId/:integrationId', getUser, isUserAdmin, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const integrationId = req.params.integrationId;
        data.projectId = req.params.projectId;
        data.userId = req.user ? req.user.id : null;
        data._id = integrationId;

        if (!data.projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'projectId missing in params, must be present',
            });
        }

        if (!data.endpoint) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'endpoint missing in body, must be present',
            });
        }

        if (!data.monitorId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'monitorId missing in body, must be present',
            });
        }

        if (!data.type) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'type is missing in body, it must be present',
            });
        }

        const existingWebhook = await IntegrationService.findOneBy({
            monitorId: data.monitorId,
            'data.endpoint': data.endpoint,
            ...(data.type === 'webhook' && {
                'data.endpointType': data.endpointType,
            }),
            integrationType: data.type,
            deleted: { $ne: null },
        });

        if (
            existingWebhook &&
            existingWebhook._id.toString() !== integrationId
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'webhook with url and endpoint type exist.',
            });
        }

        const webhook = await IntegrationService.updateOneBy(
            { _id: integrationId },
            data
        );
        return sendItemResponse(req, res, webhook);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// req => params => {teamId, projectId}
router.delete(
    '/:projectId/delete/:integrationId',
    getUser,
    isUserAdmin,
    async function(req, res) {
        try {
            const projectId = req.params.projectId;
            const integrationId = req.params.integrationId;
            const userId = req.user ? req.user.id : null;
            const data = await IntegrationService.deleteBy(
                { _id: integrationId, projectId: projectId },
                userId
            );
            return sendItemResponse(req, res, data);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// req => params => {projectId}
router.get('/:projectId/hooks', getUser, async function(req, res) {
    try {
        const projectId = req.params.projectId;
        const integrationType = req.query.type || 'webhook';
        const integrations = await IntegrationService.findBy(
            { projectId: projectId, integrationType: integrationType },
            req.query.skip || 0,
            req.query.limit || 10
        );
        const count = await IntegrationService.countBy({
            projectId: projectId,
            integrationType: integrationType,
        });
        return sendListResponse(req, res, integrations, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
