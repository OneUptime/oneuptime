import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
const router: ExpressRouter = Express.getRouter();
import ProbeService from '../services/probeService';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { isValidMonitor } from '../middlewares/api';

const incomingHttpRequest: Function = async (
    req: ExpressRequest,
    res: ExpressResponse
): void => {
    try {
        const monitor: $TSFixMe = req.monitor;
        const body: $TSFixMe = req.body;
        const queryParams: $TSFixMe = req.query;
        const headers: $TSFixMe = req.headers;
        const response: $TSFixMe = await ProbeService.processHttpRequest({
            monitor,
            body,
            queryParams,
            headers,
        });
        return sendItemResponse(req, res, response);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
};

router.get('/:id', isValidMonitor, incomingHttpRequest);

router.post('/:id', isValidMonitor, incomingHttpRequest);

export default router;
