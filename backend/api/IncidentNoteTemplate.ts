import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';
const router = express.getRouter();
const getUser = require('../middlewares/user').getUser;
import BadDataException from 'common/Types/Exception/BadDataException';
import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';
import Exception from 'common/Types/Exception/Exception';

import { sendListResponse } from 'common-server/utils/response';
import IncidentNoteTemplateService from '../services/incidentNoteTemplateService';

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId } = req.params;
            const { incidentState, incidentNote, name } = req.body;

            if (!projectId) {
                throw new BadDataException('Project Id must be present');
            }
            if (!name) {
                throw new BadDataException('Name must be present');
            }
            if (!incidentState) {
                throw new BadDataException('Incident state must be present');
            }
            if (!incidentNote) {
                throw new BadDataException('Incident note must be present');
            }

            const data = {
                projectId,
                name,
                incidentState,
                incidentNote,
            };
            const incidentNoteTemplate =
                await IncidentNoteTemplateService.create(data);

            return sendItemResponse(req, res, incidentNoteTemplate);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId } = req.params;
            const { skip, limit } = req.query;

            if (!projectId) {
                throw new BadDataException('Project Id must be present');
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:templateId',
    getUser,
    isAuthorized,
    async function (req, res) {
        try {
            const { projectId, templateId } = req.params;
            const { name, incidentNote, incidentState } = req.body;

            if (!projectId) {
                throw new BadDataException('Project Id must be present');
            }
            if (!templateId) {
                const error = new Error(
                    'Incident note template Id must be present'
                );

                error.code = 400;
                throw error;
            }
            if (!name) {
                throw new BadDataException('Name must be present');
            }
            if (!incidentState) {
                throw new BadDataException('Incident state must be present');
            }
            if (!incidentNote) {
                throw new BadDataException('Incident note must be present');
            }

            const query = { projectId, _id: templateId };
            const data = { projectId, name, incidentState, incidentNote };

            const incidentNoteTemplate =
                await IncidentNoteTemplateService.updateOneBy({ query, data });
            return sendItemResponse(req, res, incidentNoteTemplate);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:templateId',
    getUser,
    isAuthorized,
    async function (req, res) {
        try {
            const { projectId, templateId } = req.params;

            if (!projectId) {
                throw new BadDataException('Project Id must be present');
            }
            if (!templateId) {
                const error = new Error(
                    'Incident note template Id must be present'
                );

                error.code = 400;
                throw error;
            }

            const incidentNoteTemplate =
                await IncidentNoteTemplateService.deleteBy({
                    projectId,
                    _id: templateId,
                });
            return sendItemResponse(req, res, incidentNoteTemplate);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
