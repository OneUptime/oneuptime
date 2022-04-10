import express, {
    ExpressRequest,
    ExpressResponse,
    OneUptimeRequest,
    ProbeRequest,
} from 'Common-server/Utils/Express';
import MonitorService from '../Services/monitorService';
const router = express.getRouter();
import ProbeAuthorization from 'Common-server/middleware/ProbeAuthorization';
import { sendErrorResponse } from 'Common-server/Utils/Response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'Common-server/Utils/Response';
import PositiveNumber from 'Common/Types/PositiveNumber';

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
