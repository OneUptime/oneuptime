import Express, {
    ExpressRequest,
    ExpressResponse,
    OneUptimeRequest,
    ProbeRequest,
    ExpressRouter,
} from 'CommonServer/Utils/Express';

import Service from 'CommonServer/Services/Index';
import MonitorServiceClass from 'CommonServer/Services/MonitorService';
import ProbeAuthorization from 'CommonServer/Middleware/ProbeAuthorization';
import Response from 'CommonServer/Utils/Response';
import Exception from 'Common/Types/Exception/Exception';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Monitor from 'Common/Models/Monitor';

const MonitorService: MonitorServiceClass = Service.MonitorService;
const router: ExpressRouter = Express.getRouter();

router.get(
    '/monitors',
    ProbeAuthorization.isAuthorizedProbeMiddleware,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
            const limit: PositiveNumber = new PositiveNumber(
                parseInt((req.query['limit'] as string) || '10')
            );

            const monitors: Array<Monitor> =
                await MonitorService.getMonitorsNotPingedByProbeInLastMinute(
                    (oneUptimeRequest.probe as ProbeRequest).id,
                    limit
                );

            return Response.sendListResponse(
                req,
                res,
                monitors,
                new PositiveNumber(monitors.length)
            );
        } catch (error) {
            return Response.sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
