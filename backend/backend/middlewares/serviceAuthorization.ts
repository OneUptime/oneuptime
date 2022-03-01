const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
import ErrorService from 'common-server/utils/error';
const CLUSTER_KEY = process.env.CLUSTER_KEY;

export default {
    isAuthorizedService: async function(
        req: express.Request,
        res: express.Response,
        next: express.RequestHandler
    ) {
        try {
            let clusterKey;

            if (req.params && req.params.clusterKey) {
                clusterKey = req.params.clusterKey;
            } else if (req.query && req.query.clusterKey) {
                clusterKey = req.query.clusterKey;
            } else if (
                req.headers &&
                (req.headers['clusterKey'] || req.headers['clusterkey'])
            ) {
                clusterKey =
                    req.headers['clusterKey'] || req.headers['clusterkey'];
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
        } catch (error) {
            ErrorService.log('serviceAuthorization.isAuthorizedService', error);
            throw error;
        }
    },
};
