const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
import ErrorService from 'common-server/utils/error';
export default {
    isAuthorizedLighthouse: async function(
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
            }

            if (!clusterKey) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Authorization Rejected.',
                });
            }

            next();
        } catch (error) {
            ErrorService.log(
                'lighthouseAuthorization.isAuthorizedLighthouse',
                error
            );
            throw error;
        }
    },
};
