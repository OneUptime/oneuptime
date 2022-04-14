import express, {
    ExpressRequest,
    ExpressResponse,
    OneUptimeRequest,
    ProbeRequest,
} from 'CommonServer/utils/Express';
import MonitorService from '../Services/monitorService';
const router: $TSFixMe = express.getRouter();
import ProbeAuthorization from 'CommonServer/middleware/ProbeAuthorization';
import { sendErrorResponse } from 'CommonServer/utils/Response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/utils/Response';
import PositiveNumber from 'Common/Types/PositiveNumber';

router.get(
    '/monitors',
    ProbeAuthorization.isAuthorizedProbe,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const oneUptimeRequest: $TSFixMe = req as OneUptimeRequest;
            const limit: PositiveNumber = new PositiveNumber(
                parseInt((req.query['limit'] as string) || '10')
            );

            const monitors: $TSFixMe = await MonitorService.getProbeMonitors(
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
