import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import IntegrationService from '../services/integrationService';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserAdmin: $TSFixMe = require('../middlewares/project').isUserAdmin;
import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

const router: $TSFixMe = express.getRouter();

router.post(
    '/:projectId/create',
    getUser,
    isUserAdmin,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
            const body: $TSFixMe = req.body;

            const userId: $TSFixMe = req.user ? req.user.id : null;

            const monitors: $TSFixMe = body.monitors;
            const endpoint: $TSFixMe = body.endpoint;
            const webHookName: $TSFixMe = body.webHookName;
            const endpointType: $TSFixMe = body.endpointType;
            const incidentCreated: $TSFixMe = body.incidentCreated;
            const incidentResolved: $TSFixMe = body.incidentResolved;
            const incidentAcknowledged: $TSFixMe = body.incidentAcknowledged;
            const incidentNoteAdded: $TSFixMe = body.incidentNoteAdded;
            const integrationType: $TSFixMe = body.type;
            const select: $TSFixMe =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate: $TSFixMe = [
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
                const query: $TSFixMe = {
                    webHookName,
                    integrationType,
                    deleted: { $ne: null },
                };

                const existingName: $TSFixMe =
                    await IntegrationService.findOneBy({
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

            const existingWebhook: $TSFixMe =
                await IntegrationService.findOneBy({
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

            const data: $TSFixMe = {
                userId,
                endpoint,
                endpointType,
                monitors,
                webHookName,
            };
            const notificationOptions: $TSFixMe = {
                incidentCreated,
                incidentAcknowledged,
                incidentResolved,
                incidentNoteAdded,
            };

            const webhook: $TSFixMe = await IntegrationService.create(
                projectId,
                userId,
                data,
                integrationType,
                notificationOptions
            );
            return sendItemResponse(req, res, webhook);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// update webhook
router.put(
    '/:projectId/:integrationId',
    getUser,
    isUserAdmin,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const data: $TSFixMe = req.body;
            const integrationId: $TSFixMe = req.params.integrationId;
            data.projectId = req.params.projectId;

            data.userId = req.user ? req.user.id : null;
            data._id = integrationId;
            const select: $TSFixMe =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate: $TSFixMe = [
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
                const existingName: $TSFixMe =
                    await IntegrationService.findOneBy({
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
                data.monitors.map((monitor: $TSFixMe) => {
                    return {
                        monitorId: monitor,
                    };
                });

            const existingWebhook: $TSFixMe =
                await IntegrationService.findOneBy({
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

            const webhook: $TSFixMe = await IntegrationService.updateOneBy(
                { _id: integrationId },
                data
            );
            return sendItemResponse(req, res, webhook);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// req => params => {teamId, projectId}
router.delete(
    '/:projectId/delete/:integrationId',
    getUser,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
            const integrationId: $TSFixMe = req.params.integrationId;

            const userId: $TSFixMe = req.user ? req.user.id : null;
            const data: $TSFixMe = await IntegrationService.deleteBy(
                { _id: integrationId, projectId: projectId },
                userId
            );
            return sendItemResponse(req, res, data);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// req => params => {projectId}
router.get(
    '/:projectId/hooks',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
            const integrationType: $TSFixMe = req.query.type || 'webhook';
            const select: $TSFixMe =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate: $TSFixMe = [
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: [{ path: 'componentId', select: 'name' }],
                },
            ];
            const integrations: $TSFixMe = await IntegrationService.findBy({
                query: {
                    projectId: projectId,
                    integrationType: integrationType,
                },
                skip: req.query['skip'] || 0,
                limit: req.query['limit'] || 10,
                select,
                populate,
            });
            const count: $TSFixMe = await IntegrationService.countBy({
                projectId: projectId,
                integrationType: integrationType,
            });
            return sendListResponse(req, res, integrations, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// req => params => {projectId, monitorId}
router.get(
    '/:projectId/hooks/:monitorId',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            // const projectId: $TSFixMe = req.params.projectId;
            const integrationType: $TSFixMe = req.query.type || 'webhook';
            const select: $TSFixMe =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate: $TSFixMe = [
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: [{ path: 'componentId', select: 'name' }],
                },
            ];

            const { monitorId }: $TSFixMe = req.params;
            const integrations: $TSFixMe = await IntegrationService.findBy({
                query: {
                    'monitors.monitorId': { $in: [monitorId] },
                    integrationType: integrationType,
                },
                skip: req.query['skip'] || 0,
                limit: req.query['limit'] || 10,
                select,
                populate,
            });
            const count: $TSFixMe = await IntegrationService.countBy({
                'monitors.monitorId': { $in: [monitorId] },
                integrationType: integrationType,
            });
            return sendListResponse(req, res, integrations, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
