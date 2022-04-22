import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
const router: ExpressRouter = Express.getRouter();

import AutomatedScriptService from '../services/automatedScriptService';
import {
    sendErrorResponse,
    sendItemResponse,
    sendListResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { isAuthorized } from '../middlewares/authorization';

import { getUser } from '../middlewares/user';

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;
            const { skip, limit }: $TSFixMe = req.query;
            const selectScript: $TSFixMe =
                'name script scriptType slug projectId successEvent failureEvent';
            const [scripts, count]: $TSFixMe = await Promise.all([
                AutomatedScriptService.findBy({
                    query: { projectId },
                    skip,
                    limit,
                    select: selectScript,
                }),
                AutomatedScriptService.countBy({ projectId }),
            ]);
            return sendListResponse(req, res, scripts, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/:automatedSlug',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { automatedSlug }: $TSFixMe = req.params;
            const { skip, limit }: $TSFixMe = req.query;

            const selectScript: $TSFixMe =
                'name script scriptType slug projectId successEvent failureEvent';
            const populateScript: $TSFixMe = [
                { path: 'createdById', select: 'name' },
            ];
            const details: $TSFixMe = await AutomatedScriptService.findOneBy({
                query: { slug: automatedSlug },
                select: selectScript,
                populate: populateScript,
            });

            if (details.successEvent.length > 0) {
                details.successEvent = formatEvent(details.successEvent);
            }

            if (details.failureEvent.length > 0) {
                details.failureEvent = formatEvent(details.failureEvent);
            }

            const [logs, count]: $TSFixMe = await Promise.all([
                AutomatedScriptService.getAutomatedLogs(
                    {
                        automationScriptId: details._id,
                    },
                    skip,
                    limit
                ),
                AutomatedScriptService.countLogsBy({
                    automationScriptId: details._id,
                }),
            ]);
            const response: $TSFixMe = {
                details,
                logs,
            };

            return sendListResponse(req, res, response, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route Description: Creates a new script
 * Req.body -> {name, scriptType, script, successEvent, failureEvent}
 * Returns: response new script created
 */
router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            data.projectId = req.params['projectId'];
            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Values should not be null',
                });
            }
            if (!data.name || !data.name.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Script name is required',
                });
            }

            if (!data.scriptType || data.scriptType.trim().length === 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Script Type is required',
                });
            }

            if (!data.script || data.script.trim().length === 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Script is required',
                });
            }

            // Check if name already exists
            const uniqueName: $TSFixMe = await AutomatedScriptService.countBy({
                projectId: data.projectId,
                name: data.name,
            });

            if (uniqueName && uniqueName > 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Script name already exists',
                });
            }

            if (data.successEvent.length > 0) {
                data.successEvent = formatEvent(data.successEvent, true);
            }
            if (data.failureEvent.length > 0) {
                data.failureEvent = formatEvent(data.failureEvent, true);
            }
            const response: $TSFixMe =
                await AutomatedScriptService.createScript(data);
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route Description: Update a script
 * Req.body -> {name, scriptType, script, successEvent, failureEvent}
 * Returns: response script updated
 */
router.put(
    '/:projectId/:automatedScriptId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const automatedScriptId: $TSFixMe = req.params['automatedScriptId'];
            const data: $TSFixMe = req.body;
            data.projectId = req.params['projectId'];
            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Values should not be null',
                });
            }
            if (!data.name || !data.name.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Script name is required',
                });
            }

            if (!data.scriptType || data.scriptType.trim().length === 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Script Type is required',
                });
            }

            if (!data.script || data.script.trim().length === 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Script is required',
                });
            }

            // Check if name already exist
            const scriptCount: $TSFixMe = await AutomatedScriptService.countBy({
                projectId: data.projectId,
                name: data.name,
                _id: { $ne: automatedScriptId },
            });

            if (scriptCount && scriptCount > 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Script name already exists',
                });
            }

            if (data.successEvent.length > 0) {
                data.successEvent = formatEvent(data.successEvent, true);
            }
            if (data.failureEvent.length > 0) {
                data.failureEvent = formatEvent(data.failureEvent, true);
            }
            const response: $TSFixMe = await AutomatedScriptService.updateOne(
                { _id: automatedScriptId },
                data
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:automatedScriptId/run',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { automatedScriptId }: $TSFixMe = req.params;

            const triggeredId: $TSFixMe = req.user ? req.user.id : null;
            const response: $TSFixMe = await AutomatedScriptService.runResource(
                {
                    triggeredId,
                    triggeredBy: 'user',
                    resources: { automatedScript: automatedScriptId },
                }
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:automatedSlug',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, automatedSlug }: $TSFixMe = req.params;
            const query: $TSFixMe = {
                slug: automatedSlug,
            };
            const populate: $TSFixMe = [
                { path: 'createdById', select: 'name' },
            ];
            const select: $TSFixMe =
                'name script scriptType slug projectId successEvent failureEvent';
            const { _id }: $TSFixMe = await AutomatedScriptService.findOneBy({
                query,
                select,
                populate,
            });

            const userId: $TSFixMe = req.user ? req.user.id : null;
            const response: $TSFixMe = await AutomatedScriptService.deleteBy(
                {
                    slug: automatedSlug,
                },
                userId
            );
            await AutomatedScriptService.removeScriptFromEvent({
                projectId,
                id: _id,
            });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

const formatEvent: Function = (arr: $TSFixMe, type: $TSFixMe): void => {
    const result: $TSFixMe = [];
    for (const item of arr) {
        if (type) {
            result.push({ [item.type]: item.resource });
        } else {
            for (const [key, value] of Object.entries(item)) {
                if (key !== '_id') {
                    result.push({
                        type: String(key),
                        resource: String(value),
                    });
                }
            }
        }
    }
    return result;
};

export default router;
