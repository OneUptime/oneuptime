import express from 'express';
const router = express.Router();

import AuditLogsService from '../services/auditLogsService';
const getUser = require('../middlewares/user').getUser;
const isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;

import { sendItemResponse } from '../middlewares/response';

router.get('/', getUser, isUserMasterAdmin, async function(req:express.Request, res: express.Response) {
    try {
        const query = {};
        const skip = req.query.skip;
        const limit = req.query.limit;

        const populateAuditLog = [
            { path: 'userId', select: 'name' },
            { path: 'projectId', select: 'name' },
        ];

        const selectAuditLog = 'userId projectId request response createdAt';
        const [auditLogs, count] = await Promise.all([
            AuditLogsService.findBy({
                query,
                skip,
                limit,
                select: selectAuditLog,
                populate: populateAuditLog,
            }),
            AuditLogsService.countBy({ query }),
        ]);

        return sendListResponse(req, res, auditLogs, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/search', getUser, isUserMasterAdmin, async function(req:express.Request, res: express.Response) {
    try {
        const filter = req.body.filter;
        const skip = req.query.skip;
        const limit = req.query.limit;

        const {
            searchedAuditLogs,
            totalSearchCount,
        } = await AuditLogsService.search({ filter, skip, limit });

        return sendListResponse(req, res, searchedAuditLogs, totalSearchCount);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/', getUser, isUserMasterAdmin, async function(req:express.Request, res: express.Response) {
    try {
        const query = {};

        const msg = await AuditLogsService.hardDeleteBy({ query });

        return sendItemResponse(req, res, msg);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
