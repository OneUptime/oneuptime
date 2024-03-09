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
import MonitorService from 'CommonServer/Services/MonitorService';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import Monitor from 'Model/Models/Monitor';

const router: ExpressRouter = Express.getRouter();

const processIncomingRequest: RequestHandler = async (
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

        const monitorSecretKeyAsString: string | undefined =
            req.params['secretkey'];

        if (!monitorSecretKeyAsString) {
            throw new BadDataException('Invalid Secret Key');
        }

        const monitor: Monitor | null = await MonitorService.findOneBy({
            query: {
                incomingRequestSecretKey: new ObjectID(
                    monitorSecretKeyAsString
                ),
                monitorType: MonitorType.Server,
            },
            select: {
                _id: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!monitor || !monitor._id) {
            throw new BadDataException('Monitor not found');
        }

        const incomingRequest: IncomingMonitorRequest = {
            monitorId: new ObjectID(monitor._id),
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
    '/incoming-request/:secretkey',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        processIncomingRequest(req, res, next);
    }
);

router.get(
    '/incoming-request/:secretkey',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        processIncomingRequest(req, res, next);
    }
);

export default router;
