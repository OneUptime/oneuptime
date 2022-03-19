import express, { Request, Response } from 'common-server/utils/express';
const router = express.getRouter();
import ProbeService from '../services/probeService';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

import { isValidMonitor } from '../middlewares/api';

const incomingHttpRequest = async function (req: Request, res: Response) {
    try {
        const monitor = req.monitor;
        const body = req.body;
        const queryParams = req.query;
        const headers = req.headers;
        const response = await ProbeService.processHttpRequest({
            monitor,
            body,
            queryParams,
            headers,
        });
        return sendItemResponse(req, res, response);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
};

router.get('/:id', isValidMonitor, incomingHttpRequest);

router.post('/:id', isValidMonitor, incomingHttpRequest);

export default router;
