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
import { DisableAutomaticIncidentCreation } from 'CommonServer/EnvironmentConfig';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import Probe from 'Model/Models/Probe';
import ProbeService from 'CommonServer/Services/ProbeService';
import GlobalConfigService from 'CommonServer/Services/GlobalConfigService';
import Email from 'Common/Types/Email';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/probe/status-report/offline',
    ProbeAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const data: JSONObject = req.body;
            const statusReport: JSONObject = JSONFunctions.deserialize(
                (data as JSONObject)['statusReport'] as JSONObject
            ) as JSONObject;

            if (!statusReport) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('StatusReport not found')
                );
            }

            // process status report here.

            let isWebsiteCheckOffline = false;
            let isPingCheckOffline = false;

            if (statusReport['isWebsiteCheckOffline']) {
                isWebsiteCheckOffline = statusReport['isWebsiteCheckOffline'] as boolean;
            }

            if (statusReport['isPingCheckOffline']) {
                isPingCheckOffline = statusReport['isPingCheckOffline'] as boolean;
            }

            if (isWebsiteCheckOffline || isPingCheckOffline) {
                // email probe owner.
                const probeId: ObjectID = new ObjectID(data['probeId'] as string);

                const probe: Probe | null = await ProbeService.findOneBy({
                    query: {
                        _id: probeId.toString(),
                    },
                    select: {
                        _id: true,
                        projectId: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

                if (!probe) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Invalid Probe ID or Probe Key')
                    );
                }

                // If global probe offline? If yes, then email master-admin. 
                // If not a global probe then them email project owners. 

                const isGlobalProbe = !probe.projectId;

                if (isGlobalProbe) {
                    // email master-admin

                    const globalConfig = await GlobalConfigService.findOneBy({
                        query: {

                        },
                        select: {
                            _id: true,
                            adminNotificationEmail: true,
                        },
                        props: {
                            isRoot: true
                        }
                    });

                    if (!globalConfig) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException('Global config not found')
                        );
                    }

                    const adminNotificationEmail: Email | undefined = globalConfig.adminNotificationEmail;

                    if(adminNotificationEmail){
                        // email adminNotificationEmail

                        
                    }

                } else {
                    // email project owners. 
                }






            }

            return Response.sendJsonObjectResponse(req, res, {
                message: 'Status Report received',
            });
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/probe/response/ingest',
    ProbeAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            if (DisableAutomaticIncidentCreation) {
                return Response.sendJsonObjectResponse(req, res, {
                    message: 'Automatic incident creation is disabled.',
                });
            }

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
