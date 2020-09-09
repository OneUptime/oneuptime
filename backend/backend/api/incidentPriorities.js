const express = require('express');
const router = express.Router();
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const IncidentPrioritiesService = require('../services/incidentPrioritiesService');
const IncidentSettingsService = require('../services/incidentSettingsService');

router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    const { projectId } = req.params;
    const { skip = 0, limit = 10 } = req.query;
    if (!projectId) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Project Id must be present',
        });
    }
    try {
        const IncidentPriorities = await IncidentPrioritiesService.findBy(
            { projectId },
            limit,
            skip
        );
        const count = await IncidentPrioritiesService.countBy({ projectId });
        return sendListResponse(req, res, IncidentPriorities, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId', getUser, isAuthorized, async function(req, res) {
    const { projectId } = req.params;
    const { name, color } = req.body;
    if (!projectId) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Project Id must be present.',
        });
    }
    if (!name) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Name must be present',
        });
    }
    if (!color) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Color must be present',
        });
    }

    try {
        const IncidentPriorities = await IncidentPrioritiesService.create({
            projectId,
            name,
            color,
        });
        return sendItemResponse(req, res, IncidentPriorities);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId', getUser, isAuthorized, async function(req, res) {
    const { projectId } = req.params;
    const { _id, name, color } = req.body;

    if (!projectId) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Project Id must be present.',
        });
    }

    if (!_id) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Id must be present.',
        });
    }

    if (!name) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Name must be present',
        });
    }

    if (!color) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Color must be present',
        });
    }

    try {
        const IncidentPriorities = await IncidentPrioritiesService.updateOne(
            { projectId, _id },
            { name, color }
        );
        return sendItemResponse(req, res, IncidentPriorities);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId', getUser, isAuthorized, async function(req, res) {
    const { projectId } = req.params;
    const { _id } = req.body;

    if (!projectId) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Project Id must be present.',
        });
    }

    if (!_id) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Id must be present.',
        });
    }

    try {
        const incidentSettings = await IncidentSettingsService.findOne({
            projectId,
        });

        if (`${incidentSettings.incidentPriority}` === `${_id}`)
            return sendErrorResponse(req, res, {
                code: 400,
                message:
                    'This incident priority is marked as default and cannot be deleted.',
            });

        const IncidentPriority = await IncidentPrioritiesService.deleteBy({
            projectId,
            _id,
        });
        if (IncidentPriority) {
            return sendItemResponse(req, res, IncidentPriority);
        } else {
            return sendErrorResponse(req, res, {
                message: 'Incident priority not found',
            });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});
module.exports = router;
