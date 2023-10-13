import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
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

const processIncomingRequest: Function = async (
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

        const monitorIdAsString: string | undefined = req.params['id'];

        if (!monitorIdAsString) {
            throw new BadDataException('Monitor Id is required');
        }

        const monitorId: ObjectID = ObjectID.fromString(monitorIdAsString);

        const incomingRequest: IncomingMonitorRequest = {
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

router.post(
    '/incoming-request/:id',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        await processIncomingRequest(req, res, next);
    }
);

router.get(
    '/incoming-request/:id',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        await processIncomingRequest(req, res, next);
    }
);

export default router;
