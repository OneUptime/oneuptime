/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();

const EmailLogsService = require('../services/emailStatusService');
const getUser = require('../middlewares/user').getUser;
const isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const { sendItemResponse } = require('../middlewares/response');

router.get('/', getUser, isUserMasterAdmin, async function(req, res) {
    try {
        const query = {};
        const skip = req.query.skip;
        const limit = req.query.limit;

        const emailLogs = await EmailLogsService.findBy({ query, skip, limit });
        const count = await EmailLogsService.countBy({ query });

        return sendListResponse(req, res, emailLogs, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/search', getUser, isUserMasterAdmin, async function(req, res) {
    try {
        const filter = req.body.filter;
        const skip = req.query.skip;
        const limit = req.query.limit;

        const {
            searchedEmailLogs,
            totalSearchCount,
        } = await EmailLogsService.search({ filter, skip, limit });

        return sendListResponse(req, res, searchedEmailLogs, totalSearchCount);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/', getUser, isUserMasterAdmin, async function(req, res) {
    try {
        const query = {};

        const msg = await EmailLogsService.hardDeleteBy({ query });

        return sendItemResponse(req, res, msg);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
