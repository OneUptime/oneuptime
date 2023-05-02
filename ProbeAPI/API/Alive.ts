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
import { JSONObject } from 'Common/Types/JSON';
import Probe from 'Model/Models/Probe';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/alive',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const data: JSONObject = req.body;

            if (!data['probeId'] || !data['probeKey']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('ProbeId or ProbeKey is missing')
                );
            }

            const probeId: ObjectID = new ObjectID(data['probeId'] as string);

            const probeKey: string = data['probeKey'] as string;

            const probe: Probe | null = await ProbeService.findOneBy({
                query: {
                    _id: probeId.toString(),
                    key: probeKey,
                },
                select: {
                    _id: true,
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

            await ProbeService.updateOneById({
                id: probeId,
                data: {
                    lastAlive: OneUptimeDate.getCurrentDate(),
                },
                props: {
                    isRoot: true,
                },
            });

            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
