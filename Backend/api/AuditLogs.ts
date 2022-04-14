import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const router: $TSFixMe = express.getRouter();

import AuditLogsService from '../services/auditLogsService';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserMasterAdmin: $TSFixMe =
    require('../middlewares/user').isUserMasterAdmin;

import { sendErrorResponse } from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/Utils/response';

import { sendItemResponse } from 'CommonServer/Utils/response';

router.get(
    '/',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const query: $TSFixMe = {};
            const skip: $TSFixMe = req.query['skip'];
            const limit: $TSFixMe = req.query['limit'];

            const populateAuditLog: $TSFixMe = [
                { path: 'userId', select: 'name' },
                { path: 'projectId', select: 'name' },
            ];

            const selectAuditLog: $TSFixMe =
                'userId projectId request response createdAt';
            const [auditLogs, count]: $TSFixMe = await Promise.all([
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/search',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const filter: $TSFixMe = req.body.filter;
            const skip: $TSFixMe = req.query['skip'];
            const limit: $TSFixMe = req.query['limit'];

            const { searchedAuditLogs, totalSearchCount }: $TSFixMe =
                await AuditLogsService.search({ filter, skip, limit });

            return sendListResponse(
                req,
                res,
                searchedAuditLogs,
                totalSearchCount
            );
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const query: $TSFixMe = {};

            const msg: $TSFixMe = await AuditLogsService.hardDeleteBy({
                query,
            });

            return sendItemResponse(req, res, msg);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
