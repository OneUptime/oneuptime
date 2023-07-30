import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import ProbeAuthorization from '../Middleware/ProbeAuthorization';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import ProbeApiIngestResponse from 'Common/Types/Probe/ProbeApiIngestResponse';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ProbeMonitorResponseService from 'CommonServer/Utils/Probe/ProbeMonitorResponse';
import JSONFunctions from 'Common/Types/JSONFunctions';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/probe/response/ingest',
    ProbeAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const probeResponse: ProbeMonitorResponse =
                JSONFunctions.deserialize(
                    req.body['probeMonitorResponse']
                ) as any;

            if (!probeResponse) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('ProbeMonitorResponse not found')
                );
            }

            // process probe response here.
            const probeApiIngestResponse: ProbeApiIngestResponse =
                await ProbeMonitorResponseService.processProbeResponse(
                    probeResponse
                );

            return Response.sendJsonObjectResponse(req, res, {
                probeApiIngestResponse: probeApiIngestResponse,
            } as any);
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
