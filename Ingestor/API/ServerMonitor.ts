import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';
import MonitorService from 'CommonServer/Services/MonitorService';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import ServerMonitorResponse from 'Common/Types/Monitor/ServerMonitor/ServerMonitorResponse';
import ProbeApiIngestResponse from 'Common/Types/Probe/ProbeApiIngestResponse';
import ProbeMonitorResponseService from 'CommonServer/Utils/Probe/ProbeMonitorResponse';
import JSONFunctions from 'Common/Types/JSONFunctions';
import { JSONObject } from 'Common/Types/JSON';

const router: ExpressRouter = Express.getRouter();

router.get(
    '/server-monitor/:secretkey',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {

            debugger;

            const monitorSecretKeyAsString: string | undefined =
                req.params['secretkey'];

            if (!monitorSecretKeyAsString) {
                throw new BadDataException('Invalid Secret Key');
            }

            const monitor: Monitor | null = await MonitorService.findOneBy({
                query: {
                    serverMonitorSecretKey: new ObjectID(
                        monitorSecretKeyAsString
                    ),
                    monitorType: MonitorType.Server,
                },
                select: {
                    monitorSteps: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (!monitor) {
                throw new BadDataException('Monitor not found');
            }

            return Response.sendEntityResponse(req, res, monitor, Monitor);
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/server-monitor/response/ingest/:secretkey',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const monitorSecretKeyAsString: string | undefined =
                req.params['secretkey'];

            if (!monitorSecretKeyAsString) {
                throw new BadDataException('Invalid Secret Key');
            }

            const monitor: Monitor | null = await MonitorService.findOneBy({
                query: {
                    serverMonitorSecretKey: new ObjectID(
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

            if (!monitor) {
                throw new BadDataException('Monitor not found');
            }

            // now process this request.

            const serverMonitorResponse: ServerMonitorResponse =
                JSONFunctions.deserialize(
                    req.body['serverMonitorResponse'] as JSONObject
                ) as any;

            if (!serverMonitorResponse) {
                throw new BadDataException('Invalid Server Monitor Response');
            }

            if (!monitor.id) {
                throw new BadDataException('Monitor id not found');
            }

            serverMonitorResponse.monitorId = monitor.id;

            // process probe response here.
            const probeApiIngestResponse: ProbeApiIngestResponse =
                await ProbeMonitorResponseService.processProbeResponse(
                    serverMonitorResponse
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
