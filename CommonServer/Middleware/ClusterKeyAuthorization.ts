import { ClusterKey as CLUSTER_KEY } from '../Config';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';

import { sendErrorResponse } from '../Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';

export default class ClusterKeyAuthorization {
    public static async isAuthorizedService(
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {
        let clusterKey: $TSFixMe;

        if (req.params && req.params['clusterKey']) {
            clusterKey = req.params['clusterKey'];
        } else if (req.query && req.query['clusterKey']) {
            clusterKey = req.query['clusterKey'];
        } else if (
            req.headers &&
            (req.headers['clusterKey'] || req.headers['clusterkey'])
        ) {
            // header keys are automatically transformed to lowercase
            clusterKey = req.headers['clusterKey'] || req.headers['clusterkey'];
        } else if (req.body && req.body.clusterKey) {
            clusterKey = req.body.clusterKey;
        } else {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Cluster key not found.')
            );
        }

        const isAuthorized: $TSFixMe = clusterKey === CLUSTER_KEY;

        if (!isAuthorized) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Invalid cluster key provided')
            );
        }

        return next();
    }
}
