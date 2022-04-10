import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';
import loginHistoryService from '../services/loginHistoryService';

const router = express.getRouter();

import { isAuthorized } from '../middlewares/authorization';
const getUser = require('../middlewares/user').getUser;
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';
import Exception from 'common/Types/Exception/Exception';

router.get(
    '/:userId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId = req.params.userId;
            let { skip, limit } = req.query;
            if (!skip) {
                skip = 0;
            }
            if (!limit) {
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
