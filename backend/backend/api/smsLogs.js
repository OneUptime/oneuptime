/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();

const SmsLogsService = require('../services/smsCountService');
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
        const smsLogs = await SmsLogsService.findBy(query, limit, skip);
        const count = await SmsLogsService.countBy(query);
        return sendListResponse(req, res, smsLogs, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/', getUser, isUserMasterAdmin, async (req, res) => {
    try {
        const data = req.body;

        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Values should not be null',
            });
        }

        // if (!data.status || !data.status.trim()) {
        //     return sendErrorResponse(req, res, {
        //         code: 400,
        //         message: 'Email Log Status is required',
        //     });
        // }

        // if (!data.from || !data.from.trim()) {
        //     return sendErrorResponse(req, res, {
        //         code: 400,
        //         message: 'Email Log Sender name is required',
        //     });
        // }

        // if (!data.to || !data.to.trim()) {
        //     return sendErrorResponse(req, res, {
        //         code: 400,
        //         message: 'Email Log Recipient is required',
        //     });
        // }

        // if (!data.subject || !data.subject.trim()) {
        //     return sendErrorResponse(req, res, {
        //         code: 400,
        //         message: 'Email Log Subject is required',
        //     });
        // }

        // if (!data.body || !data.body.trim()) {
        //     return sendErrorResponse(req, res, {
        //         code: 400,
        //         message: 'Email Log Body is required',
        //     });
        // }

        // if (!data.template || !data.template.trim()) {
        //     return sendErrorResponse(req, res, {
        //         code: 400,
        //         message: 'Email Log Template is required',
        //     });
        // }
        const smsLog = await SmsLogsService.create(data);
        return sendItemResponse(req, res, smsLog);
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
            searchedSmsLogs,
            totalSearchCount,
        } = await SmsLogsService.search({ filter, skip, limit });

        return sendListResponse(req, res, searchedSmsLogs, totalSearchCount);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/', getUser, isUserMasterAdmin, async function(req, res) {
    try {
        const query = {};

        const msg = await SmsLogsService.hardDeleteBy({ query });

        return sendItemResponse(req, res, msg);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
