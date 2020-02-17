/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var express = require('express');
var router = express.Router();

var AuditLogsService = require('../services/auditLogsService');
var getUser = require('../middlewares/user').getUser;
var isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;

var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendListResponse = require('../middlewares/response').sendListResponse;

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
