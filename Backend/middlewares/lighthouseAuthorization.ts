import { sendErrorResponse } from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'CommonServer/Utils/Express';

export default {
    isAuthorizedLighthouse: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        let clusterKey: $TSFixMe;

        if (req.params && req.params.clusterKey) {
            clusterKey = req.params.clusterKey;
        } else if (req.query && req.query.clusterKey) {
            clusterKey = req.query.clusterKey;
        } else if (
            req.headers &&
            (req.headers.clusterKey || req.headers.clusterkey)
        ) {
            clusterKey = req.headers.clusterKey || req.headers.clusterkey;
        } else if (req.body && req.body.clusterKey) {
            clusterKey = req.body.clusterKey;
        }

        if (!clusterKey) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Authorization Rejected.')
            );
        }

        next();
    },
};
