import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ProbeService from 'CommonServer/Services/ProbeService';
import OneUptimeDate from 'Common/Types/Date';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import Probe from 'Model/Models/Probe';
import { JSONObject } from 'Common/Types/JSON';

const router: ExpressRouter = Express.getRouter();

// Register Global Probe. Custom Probe can be registered via dashboard.
router.post(
    '/register',
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const data: JSONObject = req.body;

            if (!data['probeKey']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('ProbeId or ProbeKey is missing')
                );
            }

            const probeKey: string = data['probeKey'] as string;

            const probe: Probe | null = await ProbeService.findOneBy({
                query: {
                    key: probeKey,
                    isGlobalProbe: true,
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (probe) {

                await ProbeService.updateOneById({
                    id: probe.id!,
                    data: {
                        name: data['probeName'] as string,
                        description: data['probeDescription'] as string,
                        lastAlive:  OneUptimeDate.getCurrentDate()
                    },
                    props: {
                        isRoot: true,
                    },
                });

                return Response.sendJsonObjectResponse(req, res, {
                    _id: probe._id?.toString(),
                    message: 'Probe already registered',
                });
            }

            let newProbe: Probe = new Probe();
            newProbe.isGlobalProbe = true;
            newProbe.key = probeKey;
            newProbe.name = data['probeName'] as string;
            newProbe.description = data['probeDescription'] as string;
            newProbe.lastAlive = OneUptimeDate.getCurrentDate();
            newProbe.shouldAutoEnableProbeOnNewMonitors = true;

            newProbe = await ProbeService.create({
                data: newProbe,
                props: {
                    isRoot: true,
                },
            });

            return Response.sendJsonObjectResponse(req, res, {
                _id: newProbe._id?.toString(),
                message: 'Probe registered successfully',
            });
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
