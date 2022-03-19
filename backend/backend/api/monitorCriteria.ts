import express, {
    Request,
    Response,
    NextFunction,
} from 'common-server/utils/express';
const router = express.getRouter();

const getUser = require('../middlewares/user').getUser;

import MonitorCriteriaService from '../services/monitorCriteriaService';

import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

router.get('/', getUser, function(req: Request, res: Response) {
    try {
        const criteria = MonitorCriteriaService.getCriteria();
        return sendItemResponse(req, res, criteria);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
