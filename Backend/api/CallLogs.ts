import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
const router: ExpressRouter = Express.getRouter();

import CallLogsService from '../services/callLogsService';
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
            const skip: $TSFixMe = req.query.skip;
            const limit: $TSFixMe = req.query.limit;
            const populate: $TSFixMe = [{ path: 'projectId', select: 'name' }];
            const select: string = 'from to projectId content status error';
            const [callLogs, count]: $TSFixMe = await Promise.all([
                CallLogsService.findBy({
                    query,
                    limit,
                    skip,
                    select,
                    populate,
                }),
                CallLogsService.countBy(query),
            ]);
            return sendListResponse(req, res, callLogs, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;

            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Values should not be null',
                });
            }
            if (!data.status || !data.status.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Call Log Status is required',
                });
            }
            if (!data.from || !data.from.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Call Log Sender name is required',
                });
            }

            if (!data.to || !data.to.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Call Log Recipient name is required',
                });
            }

            if (!data.projectId || !data.projectId.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Call Log ProjectId is required',
                });
            }

            if (!data.content || !data.content.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Call Log Content is required',
                });
            }

            const callLog: $TSFixMe = await CallLogsService.create(data);
            return sendItemResponse(req, res, callLog);
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
            const skip: $TSFixMe = req.query.skip;
            const limit: $TSFixMe = req.query.limit;

            const { searchedCallLogs, totalSearchCount }: $TSFixMe =
                await CallLogsService.search({ filter, skip, limit });

            return sendListResponse(
                req,
                res,
                searchedCallLogs,
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

            const msg: $TSFixMe = await CallLogsService.hardDeleteBy({ query });

            return sendItemResponse(req, res, msg);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
