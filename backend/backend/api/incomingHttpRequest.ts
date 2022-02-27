import express from 'express';
const router = express.Router();
import ProbeService from '../services/probeService';
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/api"' has no exported memb... Remove this comment to see the full error message
import { isValidMonitor } from '../middlewares/api';

const incomingHttpRequest = async function(req: $TSFixMe, res: $TSFixMe) {
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
