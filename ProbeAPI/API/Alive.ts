
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import ObjectID from 'Common/Types/ObjectID';
import Response from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ProbeService from 'CommonServer/Services/ProbeService';
import OneUptimeDate from 'Common/Types/Date';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/alive',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const data = req.body; 

            if(!data.probeId || !data.probeKey) {
                return Response.sendErrorResponse(req, res, new BadDataException("ProbeId or ProbeKey is missing"));
            }

            const probeId = new ObjectID(data.probeId);

            const probeKey =  new ObjectID(data.probeKey);

            const probe = await ProbeService.findOneBy({
                query: {
                    _id: probeId.toString(),
                    key: probeKey
                }, 
                select: {
                    _id: true, 
                },
                props: {
                    isRoot: true, 
                }
            })


            if(!probe){
                return Response.sendErrorResponse(req, res, new BadDataException("Invalid Probe ID or Probe Key"));
            }


            await ProbeService.updateOneById({
                id: probeId,
                data: {
                    lastAlive: OneUptimeDate.getCurrentDate()
                },
                props: {
                    isRoot: true
                }
            });

            return Response.sendEmptyResponse(req, res);

        } catch (err) {
            return next(err);
        }
    }
);


export default router;
