import { ClusterKey as ONEUPTIME_SECRET } from 'CommonServer/Config';
import {
    ExpressResponse,
    NextFunction,
} from 'CommonServer/Utils/Express';

import Response from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import Dictionary from 'Common/Types/Dictionary';
import { JSONObject } from 'Common/Types/JSON';
import Probe from 'Model/Models/Probe';
import ProbeService from 'CommonServer/Services/ProbeService';
import OneUptimeDate from 'Common/Types/Date';
import { ProbeExpressRequest } from '../Types/Request';

export default class ProbeAuthorization {
    public static getClusterKeyHeaders(): Dictionary<string> {
        return {
            clusterkey: ONEUPTIME_SECRET.toString(),
        };
    }

    public static async isAuthorizedServiceMiddleware(
        req: ProbeExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {
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

            req.probe = probe;

            return next();
    }
}
