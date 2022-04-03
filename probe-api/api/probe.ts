import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';
import MonitorService from '../services/monitorService';
const router = express.getRouter();
import { isAuthorizedProbe } from '../middlewares/probeAuthorization';
import { sendErrorResponse } from 'common-server/utils/response';
import Exception from 'common/types/exception/Exception';

import { sendListResponse } from 'common-server/utils/response';

router.get(
    '/monitors',
    isAuthorizedProbe,
    async (req: ExpressRequest, res: ExpressResponse) => {
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
