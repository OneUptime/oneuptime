import express, {
    Request,
    Response,
    NextFunction,
} from 'common-server/utils/express';
import IntegrationService from '../services/integrationService';
const getUser = require('../middlewares/user').getUser;
const isUserAdmin = require('../middlewares/project').isUserAdmin;
import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'common-server/utils/response';

const router = express.getRouter();

router.post(
    '/:projectId/create',
    getUser,
    isUserAdmin,
    async function (req, res) {
        try {
            const projectId = req.params.projectId;
            const body = req.body;

            const userId = req.user ? req.user.id : null;

            const monitors = body.monitors;
            const endpoint = body.endpoint;
            const webHookName = body.webHookName;
            const endpointType = body.endpointType;
            const incidentCreated = body.incidentCreated;
            const incidentResolved = body.incidentResolved;
            const incidentAcknowledged = body.incidentAcknowledged;
            const incidentNoteAdded = body.incidentNoteAdded;
            const integrationType = body.type;
            const select =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate = [
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: [{ path: 'componentId', select: 'name' }],
                },
            ];

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
            if (!monitors || monitors.length < 1) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'no monitor is added, add a monitor',
                });
            }

            if (!integrationType) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'type is missing in body, it must be present',
                });
            }

            if (integrationType !== 'webhook') {
                if (!webHookName) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'name missing in body, must be present',
                    });
                }
                const query = {
                    webHookName,
                    integrationType,
                    deleted: { $ne: null },
                };

                const existingName = await IntegrationService.findOneBy({
                    query,
                    select,
                    populate,
                });

                if (existingName) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'webhook with same name already exist.',
                    });
                }
            }

            const existingWebhook = await IntegrationService.findOneBy({
                query: {
                    'data.endpoint': endpoint,
                    'data.endpointType': endpointType,
                    deleted: { $ne: null },
                },
                select,
                populate,
            });

            if (existingWebhook) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'webhook with url and endpoint type exist.',
                });
            }

            const data = {
                userId,
                endpoint,
                endpointType,
                monitors,
                webHookName,
            };
            const notificationOptions = {
                incidentCreated,
                incidentAcknowledged,
                incidentResolved,
                incidentNoteAdded,
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
    }
);

// update webhook
router.put(
    '/:projectId/:integrationId',
    getUser,
    isUserAdmin,
    async function (req, res) {
        try {
            const data = req.body;
            const integrationId = req.params.integrationId;
            data.projectId = req.params.projectId;

            data.userId = req.user ? req.user.id : null;
            data._id = integrationId;
            const select =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate = [
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: [{ path: 'componentId', select: 'name' }],
                },
            ];

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

            if (!data.monitors || !data.monitors.length > 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'monitors missing in body, must be present',
                });
            }

            if (!data.type) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'type is missing in body, it must be present',
                });
            }

            if (data.type !== 'webhook') {
                if (!data.webHookName) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'name missing in body, must be present',
                    });
                }
                const existingName = await IntegrationService.findOneBy({
                    query: {
                        monitorId: data.monitorId,
                        webHookName: data.webHookName,
                        integrationType: data.type,
                        deleted: { $ne: null },
                    },
                    select,
                    populate,
                });

                if (
                    existingName &&
                    existingName._id.toString() !== integrationId
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'name of webhook already exist.',
                    });
                }
            }

            // restructure the monitors into [{monitorId: 'xyz'}]
            data.monitors =
                data.monitors &&
                data.monitors.map((monitor: $TSFixMe) => ({
                    monitorId: monitor,
                }));

            const existingWebhook = await IntegrationService.findOneBy({
                query: {
                    _id: data._id, // If the data to be updated changes, it returns null as it does not exist in the DB. Quering by _id and deleted returns the correct value
                    deleted: { $ne: null },
                },
                select,
                populate,
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
    }
);

// req => params => {teamId, projectId}
router.delete(
    '/:projectId/delete/:integrationId',
    getUser,
    isUserAdmin,
    async function (req: Request, res: Response) {
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
router.get(
    '/:projectId/hooks',
    getUser,
    async function (req: Request, res: Response) {
        try {
            const projectId = req.params.projectId;
            const integrationType = req.query.type || 'webhook';
            const select =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate = [
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: [{ path: 'componentId', select: 'name' }],
                },
            ];
            const integrations = await IntegrationService.findBy({
                query: {
                    projectId: projectId,
                    integrationType: integrationType,
                },
                skip: req.query.skip || 0,
                limit: req.query.limit || 10,
                select,
                populate,
            });
            const count = await IntegrationService.countBy({
                projectId: projectId,
                integrationType: integrationType,
            });
            return sendListResponse(req, res, integrations, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// req => params => {projectId, monitorId}
router.get(
    '/:projectId/hooks/:monitorId',
    getUser,
    async function (req: Request, res: Response) {
        try {
            // const projectId = req.params.projectId;
            const integrationType = req.query.type || 'webhook';
            const select =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate = [
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: [{ path: 'componentId', select: 'name' }],
                },
            ];

            const { monitorId } = req.params;
            const integrations = await IntegrationService.findBy({
                query: {
                    'monitors.monitorId': { $in: [monitorId] },
                    integrationType: integrationType,
                },
                skip: req.query.skip || 0,
                limit: req.query.limit || 10,
                select,
                populate,
            });
            const count = await IntegrationService.countBy({
                'monitors.monitorId': { $in: [monitorId] },
                integrationType: integrationType,
            });
            return sendListResponse(req, res, integrations, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

export default router;
