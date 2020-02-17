/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();

const AuditLogsService = require('../services/auditLogsService');
const getUser = require('../middlewares/user').getUser;
const isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;

router.get('/', getUser, isUserMasterAdmin, async function(
    req,
    res
) {
    try {
        const query = {};
        const skip = req.query.skip;
        const limit = req.query.limit;

        const auditLogs = await AuditLogsService.findBy({ query, skip, limit });
        const count = await AuditLogsService.countBy({ query });

        return sendListResponse(req, res, auditLogs, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/search', getUser, isUserMasterAdmin, async function(req, res) {
    try {
        const filter = req.body.filter;
        const skip = req.query.skip;
        const limit = req.query.limit;

        const { searchedAuditLogs, totalSearchCount } = await AuditLogsService.search({ filter, skip, limit });

        return sendListResponse(req, res, searchedAuditLogs, totalSearchCount);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
