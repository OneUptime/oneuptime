import express, {
    Request,
    Response,
    NextFunction,
} from 'common-server/utils/express';
import MonitorService from '../services/monitorService';
const router = express.getRouter();
import { isAuthorizedProbe } from '../middlewares/probeAuthorization';
import { sendErrorResponse } from 'common-server/utils/response';

import { sendListResponse } from 'common-server/utils/response';

router.get('/monitors', isAuthorizedProbe, async function(
    req: Request,
    res: Response
) {
    try {
        const { limit = '10' } = req.query;
        const monitors = await MonitorService.getProbeMonitors(
            req.probe?.id,
            parseInt(limit)
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
