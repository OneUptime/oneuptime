import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
const router: ExpressRouter = Express.getRouter();
const getUser: $TSFixMe = require('../middlewares/user').getUser;
import BadDataException from 'Common/Types/Exception/BadDataException';
import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/Utils/response';
import IncidentNoteTemplateService from '../services/incidentNoteTemplateService';

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;
            const { incidentState, incidentNote, name }: $TSFixMe = req.body;

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

            const data: $TSFixMe = {
                projectId,
                name,
                incidentState,
                incidentNote,
            };
            const incidentNoteTemplate: $TSFixMe =
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
            const { projectId }: $TSFixMe = req.params;
            const { skip, limit }: $TSFixMe = req.query;

            if (!projectId) {
                throw new BadDataException('Project Id must be present');
            }

            const query: $TSFixMe = { projectId };
            const [incidentNoteTemplates, count]: $TSFixMe = await Promise.all([
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
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { projectId, templateId }: $TSFixMe = req.params;
            const { name, incidentNote, incidentState }: $TSFixMe = req.body;

            if (!projectId) {
                throw new BadDataException('Project Id must be present');
            }
            if (!templateId) {
                const error: $TSFixMe = new Error(
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

            const query: $TSFixMe = { projectId, _id: templateId };
            const data: $TSFixMe = {
                projectId,
                name,
                incidentState,
                incidentNote,
            };

            const incidentNoteTemplate: $TSFixMe =
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
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { projectId, templateId }: $TSFixMe = req.params;

            if (!projectId) {
                throw new BadDataException('Project Id must be present');
            }
            if (!templateId) {
                const error: $TSFixMe = new Error(
                    'Incident note template Id must be present'
                );

                error.code = 400;
                throw error;
            }

            const incidentNoteTemplate: $TSFixMe =
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
