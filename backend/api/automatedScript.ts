import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/Utils/Express';
const router = express.getRouter();

import AutomatedScriptService from '../Services/automatedScriptService';
import { sendErrorResponse } from 'common-server/Utils/Response';
import Exception from 'common/types/exception/Exception';

import { sendListResponse } from 'common-server/Utils/Response';

import { sendItemResponse } from 'common-server/Utils/Response';

import { isAuthorized } from '../middlewares/authorization';

import { getUser } from '../middlewares/user';

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId } = req.params;
            const { skip, limit } = req.query;
            const selectScript =
                'name script scriptType slug projectId successEvent failureEvent';
            const [scripts, count] = await Promise.all([
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
            const { automatedSlug } = req.params;
            const { skip, limit } = req.query;

            const selectScript =
                'name script scriptType slug projectId successEvent failureEvent';
            const populateScript = [{ path: 'createdById', select: 'name' }];
            const details = await AutomatedScriptService.findOneBy({
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

            const [logs, count] = await Promise.all([
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
            const response = {
                details,
                logs,
            };

            return sendListResponse(req, res, response, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route Description: Creates a new script
// req.body -> {name, scriptType, script, successEvent, failureEvent}
// Returns: response new script created
router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data = req.body;
            data.projectId = req.params.projectId;
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

            // check if name already exists
            const uniqueName = await AutomatedScriptService.countBy({
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
            const response = await AutomatedScriptService.createScript(data);
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route Description: Update a script
// req.body -> {name, scriptType, script, successEvent, failureEvent}
// Returns: response script updated
router.put(
    '/:projectId/:automatedScriptId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const automatedScriptId = req.params.automatedScriptId;
            const data = req.body;
            data.projectId = req.params.projectId;
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

            // check if name already exist
            const scriptCount = await AutomatedScriptService.countBy({
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
            const response = await AutomatedScriptService.updateOne(
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
            const { automatedScriptId } = req.params;

            const triggeredId = req.user ? req.user.id : null;
            const response = await AutomatedScriptService.runResource({
                triggeredId,
                triggeredBy: 'user',
                resources: { automatedScript: automatedScriptId },
            });
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
            const { projectId, automatedSlug } = req.params;
            const query = {
                slug: automatedSlug,
            };
            const populate = [{ path: 'createdById', select: 'name' }];
            const select =
                'name script scriptType slug projectId successEvent failureEvent';
            const { _id } = await AutomatedScriptService.findOneBy({
                query,
                select,
                populate,
            });

            const userId = req.user ? req.user.id : null;
            const response = await AutomatedScriptService.deleteBy(
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

const formatEvent = (arr: $TSFixMe, type: $TSFixMe) => {
    const result = [];
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
