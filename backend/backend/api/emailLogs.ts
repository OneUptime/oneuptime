import express from 'express';
const router = express.Router();

import EmailLogsService from '../services/emailStatusService';
const getUser = require('../middlewares/user').getUser;
const isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;

import { sendErrorResponse } from 'common-server/utils/response';

import { sendListResponse } from 'common-server/utils/response';

import {
    sendItemResponse
} from 'common-server/utils/response';


router.get('/', getUser, isUserMasterAdmin, async function (
    req: Request,
    res: Response
) {
    try {
        const query = {};
        const skip = req.query.skip;
        const limit = req.query.limit;
        const selectEmailStatus =
            'from to subject body createdAt template status content error deleted deletedAt deletedById replyTo smtpServer';

        const [emailLogs, count] = await Promise.all([
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
        return sendErrorResponse(req, res, error);
    }
});

router.post(
    '/',
    getUser,
    isUserMasterAdmin,
    async (req: Request, res: Response) => {
        try {
            const data = req.body;

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
            const emailLog = await EmailLogsService.create(data);
            return sendItemResponse(req, res, emailLog);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put('/:emailLogsId', getUser, isUserMasterAdmin, async function (
    req,
    res
) {
    try {
        const data = req.body;
        const emailLogsId = req.params.emailLogsId;

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

        const emailLog = await EmailLogsService.updateOneBy(
            { _id: emailLogsId },
            data
        );
        return sendItemResponse(req, res, emailLog);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/search', getUser, isUserMasterAdmin, async function (
    req: Request,
    res: Response
) {
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

router.delete('/', getUser, isUserMasterAdmin, async function (
    req: Request,
    res: Response
) {
    try {
        const query = {};

        const msg = await EmailLogsService.hardDeleteBy({ query });

        return sendItemResponse(req, res, msg);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
