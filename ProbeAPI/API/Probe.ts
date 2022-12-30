import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/Utils/Express';

import ProbeAuthorization from 'CommonServer/Middleware/ProbeAuthorization';
import Response from 'CommonServer/Utils/Response';
import Exception from 'Common/Types/Exception/Exception';
import PositiveNumber from 'Common/Types/PositiveNumber';

const router: ExpressRouter = Express.getRouter();

router.get(
    '/monitors',
    ProbeAuthorization.isAuthorizedProbeMiddleware,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            // const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
            // const limit: PositiveNumber = new PositiveNumber(
            //     parseInt((req.query['limit'] as string) || '10')
            // );

            // const monitors: Array<Monitor> =
            //     await MonitorService.getMonitorsNotPingedByProbeInLastMinute(
            //         (oneUptimeRequest.probe as ProbeRequest).id,
            //         limit
            //     );

            return Response.sendJsonArrayResponse(
                req,
                res,
                [],
                new PositiveNumber(0)
            );
        } catch (error) {
            return Response.sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
