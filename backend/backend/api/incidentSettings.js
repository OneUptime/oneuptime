const express = require('express');
const router = express.Router();
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const IncidentSettingsService = require('../services/incidentSettingsService');
const { variables } = require('../config/incidentDefaultSettings');

router.get('/variables', async function(req, res) {
    try {
        return sendItemResponse(req, res, variables);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    const { projectId } = req.params;
    if (!projectId)
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Project Id must be present',
        });
    try {
        const incidentSettings = await IncidentSettingsService.findOne({
            projectId,
        });
        return sendItemResponse(req, res, incidentSettings);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId', getUser, isAuthorized, async function(req, res) {
    const { projectId } = req.params;
    const { title, description, incidentPriority } = req.body;
    if (!projectId)
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Project Id must be present',
        });
    if (!title)
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Title must be present',
        });

    try {
        const incidentSettings = await IncidentSettingsService.updateOne(
            {
                projectId,
            },
            {
                title,
                description,
                incidentPriority
            }
        );
        return sendItemResponse(req, res, incidentSettings);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
