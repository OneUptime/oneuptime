import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
const router: ExpressRouter = Express.getRouter();

import EmailLogsService from '../services/emailStatusService';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserMasterAdmin: $TSFixMe =
    require('../middlewares/user').isUserMasterAdmin;

import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

router.get(
    '/',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const query: $TSFixMe = {};
            const skip: $TSFixMe = req.query['skip'];
            const limit: $TSFixMe = req.query['limit'];
            const selectEmailStatus: $TSFixMe =
                'from to subject body createdAt template status content error deleted deletedAt deletedById replyTo smtpServer';

            const [emailLogs, count]: $TSFixMe = await Promise.all([
                EmailLogsService.findBy({
                    query,
                    skip,
                    limit,
                    select: selectEmailStatus,
                }),
                EmailLogsService.countBy(query),
            ]);

            return sendListResponse(req, res, emailLogs, count);
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
                    message: 'Email Log Status is required',
                });
            }

            if (!data.from || !data.from.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email Log Sender name is required',
                });
            }

            if (!data.to || !data.to.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email Log Recipient is required',
                });
            }

            if (!data.subject || !data.subject.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email Log Subject is required',
                });
            }

            if (!data.body || !data.body.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email Log Body is required',
                });
            }

            if (!data.template || !data.template.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email Log Template is required',
                });
            }
            const emailLog: $TSFixMe = await EmailLogsService.create(data);
            return sendItemResponse(req, res, emailLog);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:emailLogsId',
    getUser,
    isUserMasterAdmin,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const data: $TSFixMe = req.body;
            const emailLogsId: $TSFixMe = req.params['emailLogsId'];

            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Values should not be null',
                });
            }

            if (!data.status || !data.status.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email Log Status is required',
                });
            }

            if (!data.from || !data.from.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email Log Sender name is required',
                });
            }

            if (!data.to || !data.to.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email Log Recipient is required',
                });
            }

            if (!data.subject || !data.subject.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email Log Subject is required',
                });
            }

            if (!data.body || !data.body.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email Log Body is required',
                });
            }

            if (!data.template || !data.template.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email Log Template is required',
                });
            }

            const emailLog: $TSFixMe = await EmailLogsService.updateOneBy(
                { _id: emailLogsId },
                data
            );
            return sendItemResponse(req, res, emailLog);
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

            const { searchedEmailLogs, totalSearchCount }: $TSFixMe =
                await EmailLogsService.search({ filter, skip, limit });

            return sendListResponse(
                req,
                res,
                searchedEmailLogs,
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

            const msg: $TSFixMe = await EmailLogsService.hardDeleteBy({
                query,
            });

            return sendItemResponse(req, res, msg);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
