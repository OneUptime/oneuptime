/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();

const AutomatedScriptService = require('../services/automatedScriptService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const { sendItemResponse } = require('../middlewares/response');
const { isAuthorized } = require('../middlewares/authorization');
const { getUser } = require('../middlewares/user');
const postApi = require('../utils/api').postApi;
const scriptBaseUrl = process.env['SCRIPT_URL'];

router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const { projectId } = req.params;
        const { skip, limit } = req.query;
        const scripts = await AutomatedScriptService.findBy(
            { projectId },
            skip,
            limit
        );
        const count = await AutomatedScriptService.countBy({ projectId });
        return sendListResponse(req, res, scripts, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/:automatedSlug',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { automatedSlug } = req.params;
            const { skip, limit } = req.query;
            const details = await AutomatedScriptService.findOneBy({
                slug: automatedSlug,
            });
            const logs = await AutomatedScriptService.getAutomatedLogs(
                {
                    automationScriptId: details._id,
                },
                skip,
                limit
            );

            if (details.successEvent.length > 0) {
                details.successEvent = formatEvent(details.successEvent);
            }

            if (details.failureEvent.length > 0) {
                details.failureEvent = formatEvent(details.failureEvent);
            }

            const count = await AutomatedScriptService.countLogsBy({
                automationScriptId: details._id,
            });
            const response = {
                details,
                logs,
            };

            return sendListResponse(req, res, response, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route Description: Creates a new script
// req.body -> {name, scriptType, script, successEvent, failureEvent}
// Returns: response new script created
router.post('/:projectId', getUser, isAuthorized, async (req, res) => {
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

        if (data.successEvent.length > 0) {
            data.successEvent = formatEvent(data.successEvent, true);
        }
        if (data.failureEvent.length > 0) {
            data.failureEvent = formatEvent(data.failureEvent, true);
        }
        const response = await AutomatedScriptService.createScript(data);
        return sendItemResponse(req, res, response);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route Description: Update a script
// req.body -> {name, scriptType, script, successEvent, failureEvent}
// Returns: response script updated
router.put(
    '/:projectId/:automatedScriptId',
    getUser,
    isAuthorized,
    async (req, res) => {
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
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put(
    '/:projectId/:automatedScriptId/run',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { automatedScriptId } = req.params;
            const triggeredId = req.user ? req.user.id : null;
            const response = await runResource({
                triggeredId,
                triggerByUser: true,
                resources: { automatedScript: automatedScriptId },
            });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/:automatedSlug',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { automatedSlug } = req.params;
            const userId = req.user ? req.user.id : null;
            const response = await AutomatedScriptService.deleteBy(
                {
                    slug: automatedSlug,
                },
                userId
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

const runResource = async ({
    triggeredId,
    triggerByUser,
    resources,
    stackSize = 0,
}) => {
    if (stackSize > 2) {
        return;
    }
    const events = Array.isArray(resources) ? resources : [resources]; // object property => {callSchedule?, automatedScript?}
    const eventPromises = events.map(event => {
        let resourceType;
        if (event.automatedScript) {
            resourceType = 'automatedScript';
        } else if (event.callSchedule) {
            resourceType = 'callSchedule';
        }
        const automatedScriptId = event.automatedScript;
        switch (resourceType) {
            case 'automatedScript':
                return runAutomatedScript({
                    automatedScriptId,
                    triggeredId,
                    triggerByUser,
                    stackSize: stackSize + 1,
                });
            default:
                return null;
        }
    });

    return Promise.all(eventPromises);
};

const runAutomatedScript = async ({
    automatedScriptId,
    triggeredId,
    triggerByUser = false,
    stackSize,
}) => {
    const {
        script,
        scriptType,
        successEvent,
        failureEvent,
    } = await AutomatedScriptService.findOneBy({
        _id: automatedScriptId,
    });
    let data = null;
    if (scriptType === 'javascript') {
        const result = await postApi(`${scriptBaseUrl}/api/script/js`, {
            script,
        });
        data = {
            success: result.success,
            message: result.message,
            errors: result.success
                ? undefined
                : result.message + ': ' + result.errors,
            status: result.status,
            executionTime: result.executionTime,
            consoleLogs: result.consoleLogs,
        };
    } else if (scriptType === 'bash') {
        const result = await postApi(`${scriptBaseUrl}/api/script/bash`, {
            script,
        });
        data = {
            success: result.success,
            errors: result.errors,
            status: result.status,
            executionTime: result.executionTime,
            consoleLogs: result.consoleLogs,
        };
    }
    triggerByUser
        ? (data.triggerByUser = triggeredId)
        : (data.triggerByScript = triggeredId);
    if (data.success && successEvent.length > 0) {
        await runResource({
            triggeredId: automatedScriptId,
            resources: successEvent,
            stackSize,
        });
    }
    if (!data.success && failureEvent.length > 0) {
        await runResource({
            triggeredId: automatedScriptId,
            resources: failureEvent,
            stackSize,
        });
    }
    const automatedScriptLog = await AutomatedScriptService.createLog(
        automatedScriptId,
        data
    );
    await AutomatedScriptService.updateOne(
        { _id: automatedScriptId },
        { updatedAt: new Date() }
    );
    return automatedScriptLog;
};

const formatEvent = (arr, type) => {
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

module.exports = router;
