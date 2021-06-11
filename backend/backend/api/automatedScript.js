/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();

const AutomatedService = require('../services/automatedScriptService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const { sendItemResponse } = require('../middlewares/response');
const { isAuthorized } = require('../middlewares/authorization');
const { getUser } = require('../middlewares/user');

router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const { projectId } = req.params;
        const { skip, limit } = req.query;
        const scripts = await AutomatedService.findBy(
            { projectId },
            skip,
            limit
        );
        const count = await AutomatedService.countBy({ projectId });
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
            const { _id } = await AutomatedService.findOneBy({
                slug: automatedSlug,
            });
            const response = await AutomatedService.getAutomatedLogService(
                {
                    automationScriptId: _id,
                },
                skip,
                limit
            );
            const count = await AutomatedService.countLogBy({
                automationScriptId: _id,
            });
            return sendListResponse(req, res, response, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

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
        const formatEvent = arr => {
            const result = [];
            for (const a of arr) {
                if (a.type === 'callSchedule') {
                    result.push({ callSchedule: a.resource });
                } else {
                    result.push({ automatedScript: a.resource });
                }
            }
            return result;
        };
        if (data.successEvent.length > 0) {
            data.successEvent = formatEvent(data.successEvent);
        }
        if (data.failureEvent.length > 0) {
            data.failureEvent = formatEvent(data.failureEvent);
        }
        const response = await AutomatedService.createScript(data);
        return sendItemResponse(req, res, response);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put(
    '/:projectId/:automatedScriptId/run',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { automatedScriptId } = req.params;
            const userId = req.user ? req.user.id : null;
            const data = {
                triggerByUser: userId,
            };
            const response = await AutomatedService.createLog(
                automatedScriptId,
                data
            );
            await AutomatedService.updateOne(
                { _id: automatedScriptId },
                { updatedAt: new Date() }
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete('/:scriptId/:projectId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const { scriptId } = req.params;
        const msg = await AutomatedService.deleteBy(scriptId);
        return sendItemResponse(req, res, msg);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
