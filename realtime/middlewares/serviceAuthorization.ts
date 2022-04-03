import { clusterKey as CLUSTER_KEY } from '../utils/config';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'common-server/utils/express';

import { sendErrorResponse } from 'common-server/utils/response';

export default {
    isAuthorizedService: async function (
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
            // header keys are automatically transformed to lowercase
            clusterKey = req.headers['clusterKey'] || req.headers['clusterkey'];
        } else if (req.body && req.body.clusterKey) {
            clusterKey = req.body.clusterKey;
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Cluster key not found.',
            });
        }

        const isAuthorized = clusterKey === CLUSTER_KEY;

        if (!isAuthorized) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Invalid cluster key provided',
            });
        }

        return next();
    },
};
