import express, {
    ExpressRequest,
    ExpressResponse,
    OneUptimeRequest,
    ProbeRequest,
} from 'common-server/Utils/Express';
import MonitorService from '../Services/monitorService';
const router = express.getRouter();
import ProbeAuthorization from 'common-server/middleware/ProbeAuthorization';
import { sendErrorResponse } from 'common-server/Utils/Response';
import Exception from 'common/Types/Exception/Exception';

import { sendListResponse } from 'common-server/Utils/Response';
import PositiveNumber from 'common/types/PositiveNumber';

router.get(
    '/monitors',
    ProbeAuthorization.isAuthorizedProbe,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const oneUptimeRequest = req as OneUptimeRequest;
            const limit: PositiveNumber = new PositiveNumber(
                parseInt((req.query['limit'] as string) || '10')
            );

            const monitors = await MonitorService.getProbeMonitors(
                (oneUptimeRequest.probe as ProbeRequest).id,
                limit
            );

            return sendListResponse(req, res, monitors, monitors.length);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
