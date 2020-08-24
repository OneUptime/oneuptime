const express = require('express');
const router = express.Router();
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const IncidentSettingsService = require('../services/incidentSettingsService');

router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    const { projectId } = req.params;
    if (!projectId)
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Project Id must be present',
        });
    try {
        let incidentSettings = await IncidentSettingsService.findOne({
            projectId,
        });
        if (!incidentSettings) {
            incidentSettings = await IncidentSettingsService.create({
                projectId,
                title: '',
                description: '',
            });
        }
        return sendItemResponse(req, res, incidentSettings);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId', getUser, isAuthorized, async function(req, res) {
    const { projectId } = req.params;
    const { title, description } = req.body;
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
        const incidentSettings = await IncidentSettingsService.UpdateOne(
            {
                projectId,
            },
            {
                title,
                description,
            }
        );
        return sendItemResponse(req, res, incidentSettings);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
