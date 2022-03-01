import express from 'express';
const router = express.Router();
const getUser = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
import IncidentNoteTemplateService from '../services/incidentNoteTemplateService';

router.post('/:projectId', getUser, isAuthorized, async function(
    req: express.Request,
    res: express.Response
) {
    try {
        const { projectId } = req.params;
        const { incidentState, incidentNote, name } = req.body;

        if (!projectId) {
            const error = new Error('Project Id must be present');

            error.code = 400;
            throw error;
        }
        if (!name) {
            const error = new Error('Name must be present');

            error.code = 400;
            throw error;
        }
        if (!incidentState) {
            const error = new Error('Incident state must be present');

            error.code = 400;
            throw error;
        }
        if (!incidentNote) {
            const error = new Error('Incident note must be present');

            error.code = 400;
            throw error;
        }

        const data = {
            projectId,
            name,
            incidentState,
            incidentNote,
        };
        const incidentNoteTemplate = await IncidentNoteTemplateService.create(
            data
        );

        return sendItemResponse(req, res, incidentNoteTemplate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function(
    req: express.Request,
    res: express.Response
) {
    try {
        const { projectId } = req.params;
        const { skip, limit } = req.query;

        if (!projectId) {
            const error = new Error('Project Id must be present');

            error.code = 400;
            throw error;
        }

        const query = { projectId };
        const [incidentNoteTemplates, count] = await Promise.all([
            IncidentNoteTemplateService.findBy({
                query,
                skip,
                limit,
            }),
            IncidentNoteTemplateService.countBy(query),
        ]);

        return sendListResponse(req, res, incidentNoteTemplates, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:templateId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const { projectId, templateId } = req.params;
        const { name, incidentNote, incidentState } = req.body;

        if (!projectId) {
            const error = new Error('Project Id must be present');

            error.code = 400;
            throw error;
        }
        if (!templateId) {
            const error = new Error(
                'Incident note template Id must be present'
            );

            error.code = 400;
            throw error;
        }
        if (!name) {
            const error = new Error('Name must be present');

            error.code = 400;
            throw error;
        }
        if (!incidentState) {
            const error = new Error('Incident state must be present');

            error.code = 400;
            throw error;
        }
        if (!incidentNote) {
            const error = new Error('Incident note must be present');

            error.code = 400;
            throw error;
        }

        const query = { projectId, _id: templateId };
        const data = { projectId, name, incidentState, incidentNote };

        const incidentNoteTemplate = await IncidentNoteTemplateService.updateOneBy(
            { query, data }
        );
        return sendItemResponse(req, res, incidentNoteTemplate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId/:templateId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const { projectId, templateId } = req.params;

        if (!projectId) {
            const error = new Error('Project Id must be present');

            error.code = 400;
            throw error;
        }
        if (!templateId) {
            const error = new Error(
                'Incident note template Id must be present'
            );

            error.code = 400;
            throw error;
        }

        const incidentNoteTemplate = await IncidentNoteTemplateService.deleteBy(
            {
                projectId,
                _id: templateId,
            }
        );
        return sendItemResponse(req, res, incidentNoteTemplate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
