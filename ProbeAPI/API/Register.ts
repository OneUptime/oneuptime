
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
import Probe from "Model/Models/Probe";

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
            const data = req.body; 

            if(!data.probeKey) {
                return Response.sendErrorResponse(req, res, new BadDataException("ProbeId or ProbeKey is missing"));
            }


            const probeKey =  data.probeKey;

            const probe: Probe | null = await ProbeService.findOneBy({
                query: {
                    key: probeKey,
                    isGlobalProbe: true
                }, 
                select: {
                    _id: true, 
                },
                props: {
                    isRoot: true, 
                }
            })


            if(probe){
                return Response.sendTextResponse(req, res, "Probe already registered");
            }

            let newProbe: Probe = new Probe();
            newProbe.isGlobalProbe = true; 
            newProbe.key = probeKey;
            newProbe.lastAlive = OneUptimeDate.getCurrentDate();


            newProbe = await ProbeService.create({
                data: newProbe,
                props: {
                    isRoot: true
                }
            });

            return Response.sendJsonObjectResponse(req, res, {
                _id: newProbe._id?.toString(),
                "message": "Probe registered successfully"
            });

        } catch (err) {
            return next(err);
        }
    }
);


export default router;
