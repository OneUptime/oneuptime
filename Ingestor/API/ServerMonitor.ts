import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
    RequestHandler,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ProbeMonitorResponseService from 'CommonServer/Utils/Probe/ProbeMonitorResponse';
import Dictionary from 'Common/Types/Dictionary';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';
import OneUptimeDate from 'Common/Types/Date';

const router: ExpressRouter = Express.getRouter();

const processServerMonitor: RequestHandler = async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
): Promise<void> => {
    try {
        const requestHeaders: Dictionary<string> =
            req.headers as Dictionary<string>;
        const requestBody: string | JSONObject = req.body as
            | string
            | JSONObject;

        const monitorSecretKeyAsString: string | undefined = req.params['secretkey'];

        if (!monitorSecretKeyAsString) {
            throw new BadDataException('Monitor Secret Key is required');
        }

        const monitorId: ObjectID = ObjectID.fromString(monitorSecretKeyAsString);

        const serverMonitorRequest: ServerMonitorRequest = {
            monitorId: monitorId,
            requestHeaders: requestHeaders,
            requestBody: requestBody,
            incomingRequestReceivedAt: OneUptimeDate.getCurrentDate(),
            onlyCheckForIncomingRequestReceivedAt: false,
        };

        // process probe response here.
        await ProbeMonitorResponseService.processProbeResponse(incomingRequest);

        return Response.sendEmptyResponse(req, res);
    } catch (err) {
        return next(err);
    }
};

router.get(
    '/server-monitor/:secretkey',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        processServerMonitor(req, res, next);
    }
);

router.post(
    '/server-monitor/response/ingest',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        processServerMonitor(req, res, next);
    }
);

export default router;
