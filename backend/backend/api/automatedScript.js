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

router.get('/', getUser, isAuthorized, async function(req, res) {
    try {
        const scripts = await AutomatedService.findBy();
        return sendListResponse(req, res, scripts);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/', getUser, isAuthorized, async (req, res) => {
    try {
        const data = req.body;
        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Values should not be null',
            });
        }
        if (!data.name || !data.name.trim()) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Automated Script name is required',
            });
        }

        if (!data.script || !data.script.trim()) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Automated Script script is required',
            });
        }
        const callLog = await AutomatedService.create(data);
        return sendItemResponse(req, res, callLog);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:scriptId', getUser, isAuthorized, async function(req, res) {
    try {
        const { scriptId } = req.params;
        const msg = await AutomatedService.deleteBy(scriptId);
        return sendItemResponse(req, res, msg);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
