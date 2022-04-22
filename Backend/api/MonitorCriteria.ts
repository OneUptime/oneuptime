import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
const router: ExpressRouter = Express.getRouter();

const getUser: $TSFixMe = require('../middlewares/user').getUser;

import MonitorCriteriaService from '../services/monitorCriteriaService';

import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

router.get('/', getUser, (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const criteria: $TSFixMe = MonitorCriteriaService.getCriteria();
        return sendItemResponse(req, res, criteria);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;
