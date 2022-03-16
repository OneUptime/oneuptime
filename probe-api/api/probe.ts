import express, { Request, Response } from 'common-server/utils/express';
import MonitorService from '../services/monitorService';
const router = express.Router();
const isAuthorizedProbe = require('../middlewares/probeAuthorization')
    .isAuthorizedProbe;
import { sendErrorResponse } from 'common-server/utils/response';

import { sendListResponse } from 'common-server/utils/response';

router.get('/monitors', isAuthorizedProbe, async function (
    req: Request,
    res: Response
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
