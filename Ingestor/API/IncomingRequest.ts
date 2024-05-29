import HTTPMethod from 'Common/Types/API/HTTPMethod';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import ObjectID from 'Common/Types/ObjectID';
import MonitorService from 'CommonServer/Services/MonitorService';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
    RequestHandler,
} from 'CommonServer/Utils/Express';
import ProbeMonitorResponseService from 'CommonServer/Utils/Probe/ProbeMonitorResponse';
import Response from 'CommonServer/Utils/Response';
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

        const isGetRequest: boolean = req.method === 'GET';
        const isPostRequest: boolean = req.method === 'POST';

        let httpMethod: HTTPMethod = HTTPMethod.GET;

        if (isGetRequest) {
            httpMethod = HTTPMethod.GET;
        }

        if (isPostRequest) {
            httpMethod = HTTPMethod.POST;
        }

        const monitor: Monitor | null = await MonitorService.findOneBy({
            query: {
                incomingRequestSecretKey: new ObjectID(
                    monitorSecretKeyAsString
                ),
                monitorType: MonitorType.IncomingRequest,
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
            requestMethod: httpMethod,
        };

        // process probe response here.
        await ProbeMonitorResponseService.processProbeResponse(incomingRequest);

        return Response.sendEmptySuccessResponse(req, res);
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
