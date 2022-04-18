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
import IncidentSettingsService from '../services/incidentSettingsService';
import IncidentPrioritiesService from '../services/incidentPrioritiesService';

import { variables } from '../config/incidentDefaultSettings';

router.get('/variables', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        return sendItemResponse(req, res, variables);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// Fetch default incident template in a project
router.get(
    '/:projectId/default',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { projectId }: $TSFixMe = req.params;
            if (!projectId) {
                throw new BadDataException('Project Id must be present');
            }
            const select: $TSFixMe =
                'projectId title description incidentPriority isDefault name createdAt';

            const query: $TSFixMe = { projectId, isDefault: true };
            const template: $TSFixMe = await IncidentSettingsService.findOne({
                query,
                select,
            });

            return sendItemResponse(req, res, template);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Fetch all incident template in a project
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
            const populate: $TSFixMe = [
                { path: 'incidentPriority', select: 'name color' },
            ];
            const select: $TSFixMe =
                'projectId title description incidentPriority isDefault name createdAt';
            const [templates, count]: $TSFixMe = await Promise.all([
                IncidentSettingsService.findBy({
                    query,
                    limit,
                    skip,
                    select,
                    populate,
                }),
                IncidentSettingsService.countBy(query),
            ]);

            return sendListResponse(req, res, templates, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:templateId/setDefault',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { projectId, templateId }: $TSFixMe = req.params;
        if (!projectId) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Project Id must be present.')
            );
        }

        try {
            const defaultPrioritySetting: $TSFixMe =
                await IncidentSettingsService.updateOne(
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:templateId',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        const { projectId, templateId }: $TSFixMe = req.params;
        const {
            title,
            description,
            incidentPriority,
            isDefault,
            name,
        }: $TSFixMe = req.body;
        if (!projectId) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Project Id must be present.')
            );
        }

        if (!templateId) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Incident settings Id must be present.')
            );
        }

        if (!name) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Name must be present')
            );
        }

        if (!title) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Title must be present.')
            );
        }

        if (!incidentPriority) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Incident priority must be present.')
            );
        }

        try {
            //Update should not happen if the incident priority is remove and doesn't exist.
            const priority: $TSFixMe = await IncidentPrioritiesService.countBy({
                _id: incidentPriority,
            });

            if (!priority || priority === 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "Incident priority doesn't exist.",
                });
            }

            const incidentSettings: $TSFixMe =
                await IncidentSettingsService.updateOne(
                    {
                        projectId,
                        _id: templateId,
                    },
                    {
                        title,
                        description,
                        incidentPriority,
                        isDefault,
                        name,
                    }
                );
            return sendItemResponse(req, res, incidentSettings);
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
                    'Incident settings Id must be present.'
                );

                error.code = 400;
                throw error;
            }

            const incidentSetting: $TSFixMe =
                await IncidentSettingsService.deleteBy({
                    _id: templateId,
                    projectId,
                });
            return sendItemResponse(req, res, incidentSetting);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;
            // Description is optional
            const {
                title,
                description,
                incidentPriority,
                isDefault = false,
                name,
            } = req.body;

            if (!projectId) {
                throw new BadDataException('Project Id must be present');
            }
            if (!name) {
                throw new BadDataException('Name must be present');
            }
            if (!title) {
                throw new BadDataException('Title must be present');
            }
            if (!incidentPriority) {
                throw new BadDataException('Incident priority must be present');
            }

            const priority: $TSFixMe = await IncidentPrioritiesService.findOne({
                query: { _id: incidentPriority },
                select: '_id',
            });
            if (!priority) {
                const error: $TSFixMe = new Error(
                    "Incident priority doesn't exist."
                );

                error.code = 400;
                throw error;
            }

            const data: $TSFixMe = {
                projectId,
                title,
                description,
                incidentPriority,
                isDefault,
                name,
            };
            const incidentSetting: $TSFixMe =
                await IncidentSettingsService.create(data);

            return sendItemResponse(req, res, incidentSetting);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
