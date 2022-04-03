import { sendErrorResponse } from 'common-server/utils/response';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'common-server/utils/Express';

export default {
    isAuthorizedLighthouse: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) {
        let clusterKey;

        if (req.params && req.params.clusterKey) {
            clusterKey = req.params.clusterKey;
        } else if (req.query && req.query.clusterKey) {
            clusterKey = req.query.clusterKey;
        } else if (
            req.headers &&
            (req.headers['clusterKey'] || req.headers['clusterkey'])
        ) {
            clusterKey = req.headers['clusterKey'] || req.headers['clusterkey'];
        } else if (req.body && req.body.clusterKey) {
            clusterKey = req.body.clusterKey;
        }

        if (!clusterKey) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Authorization Rejected.',
            });
        }

        next();
    },
};
