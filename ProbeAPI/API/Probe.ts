import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import ProbeAuthorization from '../Middleware/ProbeAuthorization';
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";

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

            const probeResponses: Array<ProbeMonitorResponse> = req.body['probeMonitorResponses'];

            if(!probeResponses || probeResponses.length === 0){
                return Response.sendEmptyResponse(req, res);
            }

            // save data to Clickhouse.

            

            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
