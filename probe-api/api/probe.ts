import express from 'express';
import MonitorService from '../services/monitorService';
const router = express.Router();
const isAuthorizedProbe = require('../middlewares/probeAuthorization')
    .isAuthorizedProbe;
import { sendErrorResponse } from 'common-server/utils/response';

import { sendListResponse } from 'common-server/utils/response';

router.get('/monitors', isAuthorizedProbe, async function (
    req: $TSFixMe,
    res: $TSFixMe
) {
    try {
        const { limit = 10 } = req.query;
        const monitors = await MonitorService.getProbeMonitors(
            req.probe.id,
            limit
        );

        return sendListResponse(
            req,
            res,
            JSON.stringify(monitors),
            monitors.length
        );
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
