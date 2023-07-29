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
import ProbeMonitorResponseService from '../Service/ProbeMonitorResponse';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Dictionary from 'Common/Types/Dictionary';
import { JSONObject } from 'Common/Types/JSON';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/incoming-request/:monitor-id',
    ProbeAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const requestHeaders: Dictionary<string> = req.headers as Dictionary<string>;
            const requesdyBody:  string | JSONObject  = req.body as  string | JSONObject;

            

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
