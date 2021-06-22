const express = require('express');
const router = express.Router();
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const IncidentSettingsService = require('../services/incidentSettingsService');
const IncidentPrioritiesService = require('../services/incidentPrioritiesService');
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

// fetch all incident template in a project
router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const { projectId } = req.params;
        const { skip, limit } = req.query;

        if (!projectId) {
            const error = new Error('Project Id must be present');
            error.code = 400;
            throw error;
        }

        const query = { projectId };
        const templates = await IncidentSettingsService.findBy({
            query,
            limit,
            skip,
        });
        const count = await IncidentSettingsService.countBy(query);
        return sendListResponse(req, res, templates, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put(
    '/:projectId/:templateId/setDefault',
    getUser,
    isAuthorized,
    async function(req, res) {
        const { projectId, templateId } = req.params;
        if (!projectId)
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project Id must be present.',
            });

        try {
            const defaultPrioritySetting = await IncidentSettingsService.updateOne(
                {
                    _id: templateId,
                    projectId,
                },
                {
                    isDefault: true,
                }
            );
            return sendItemResponse(req, res, defaultPrioritySetting);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put('/:projectId/:templateId', getUser, isAuthorized, async function(
    req,
    res
) {
    const { projectId, templateId } = req.params;
    const { title, description, incidentPriority, isDefault } = req.body;
    if (!projectId)
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Project Id must be present.',
        });

    if (!templateId)
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Incident settings Id must be present.',
        });

    if (!title)
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Title must be present.',
        });

    if (!incidentPriority)
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Incident priority must be present.',
        });

    try {
        //Update should not happen if the incident priority is remove and doesn't exist.
        const priority = await IncidentPrioritiesService.findOne({
            _id: incidentPriority,
        });

        if (!priority)
            return sendErrorResponse(req, res, {
                code: 400,
                message: "Incident priority doesn't exist.",
            });

        const incidentSettings = await IncidentSettingsService.updateOne(
            {
                projectId,
                _id: templateId,
            },
            {
                title,
                description,
                incidentPriority,
                isDefault,
            }
        );
        return sendItemResponse(req, res, incidentSettings);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const { projectId } = req.params;
        // description is optional
        const {
            title,
            description,
            incidentPriority,
            isDefault = false,
        } = req.body;

        if (!projectId) {
            const error = new Error('Project Id must be present');
            error.code = 400;
            throw error;
        }
        if (!title) {
            const error = new Error('Title must be present');
            error.code = 400;
            throw error;
        }
        if (!incidentPriority) {
            const error = new Error('Incident priority must be present');
            error.code = 400;
            throw error;
        }

        const priority = await IncidentPrioritiesService.findOne({
            _id: incidentPriority,
        });
        if (!priority) {
            const error = new Error("Incident priority doesn't exist.");
            error.code = 400;
            throw error;
        }

        const data = {
            projectId,
            title,
            description,
            incidentPriority,
            isDefault,
        };
        const incidentSetting = await IncidentSettingsService.create(data);

        return sendItemResponse(req, res, incidentSetting);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
