import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import ProbeApiIngestResponse from 'Common/Types/Probe/ProbeApiIngestResponse';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ProbeMonitorResponseService from 'CommonServer/Utils/Probe/ProbeMonitorResponse';
import Dictionary from 'Common/Types/Dictionary';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';
import OneUptimeDate from 'Common/Types/Date';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/incoming-request/:monitor-id',
    async (
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

            const monitorIdAsString: string | undefined =
                req.params['monitor-id'];

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
            const probeApiIngestResponse: ProbeApiIngestResponse =
                await ProbeMonitorResponseService.processProbeResponse(
                    incomingRequest
                );

            return Response.sendJsonObjectResponse(req, res, {
                monitorId: probeApiIngestResponse.monitorId.toString(),
                rootCause: probeApiIngestResponse.rootCause,
                criteriaMetId: probeApiIngestResponse.criteriaMetId?.toString(),
            } as any);
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
