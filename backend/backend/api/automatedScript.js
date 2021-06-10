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
            const { automatedSlug, projectId } = req.params;
            const response = await AutomatedService.getAutomatedService({
                projectId,
                slug: automatedSlug,
            });
            return sendListResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post('/:projectId', getUser, isAuthorized, async (req, res) => {
    try {
        const data = req.body;
        const userId = req.user ? req.user.id : null;
        data.projectId = req.params.projectId;
        data.createdById = userId;
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
        const response = await AutomatedService.create(data);
        return sendItemResponse(req, res, response);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

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
