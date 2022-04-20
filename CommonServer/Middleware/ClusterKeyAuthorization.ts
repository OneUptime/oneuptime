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
        let clusterKey: string;

        if (req.params && req.params['clusterKey']) {
            clusterKey = req.params['clusterKey'];
        } else if (req.query && req.query['clusterKey']) {
            clusterKey = req.query['clusterKey'] as string;
        } else if (
            req.headers &&
            (req.headers['clusterkey'] || req.headers['clusterkey'])
        ) {
            // Header keys are automatically transformed to lowercase
            clusterKey =
                (req.headers['clusterkey'] as string) ||
                (req.headers['clusterkey'] as string);
        } else if (req.body && req.body.clusterKey) {
            clusterKey = req.body.clusterKey;
        } else {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Cluster key not found.')
            );
        }

        const isAuthorized: boolean = clusterKey === CLUSTER_KEY;

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
