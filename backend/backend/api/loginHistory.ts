import express from 'express';
import loginHistoryService from '../services/loginHistoryService';

const router = express.Router();
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/authorization"' has no exp... Remove this comment to see the full error message
import { isAuthorized } from '../middlewares/authorization';
const getUser = require('../middlewares/user').getUser;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.get('/:userId', getUser, isAuthorized, async function(req, res) {
    try {
        const userId = req.params.userId;
        let { skip, limit } = req.query;
        if (!skip) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type '0' is not assignable to type 'string | Parse... Remove this comment to see the full error message
            skip = 0;
        }
        if (!limit) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type '10' is not assignable to type 'string | Pars... Remove this comment to see the full error message
            limit = 10;
        }
        const select = 'userId createdAt ipLocation device status';
        const historyLogs = await loginHistoryService.findBy({
            query: { userId },
            skip,
            limit,
            select,
        });

        return sendItemResponse(req, res, historyLogs);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
