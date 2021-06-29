/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const ErrorService = require('../services/errorService');
const CLUSTER_KEY = process.env.CLUSTER_KEY;

module.exports = {
    isAuthorizedService: async function(req, res, next) {
        try {
            let clusterKey;

            if (req.params.clusterKey) {
                clusterKey = req.params.clusterKey;
            } else if (req.query.clusterKey) {
                clusterKey = req.query.clusterKey;
            } else if (req.headers['clusterKey']) {
                clusterKey = req.headers['clusterKey'];
            } else if (req.headers['clusterkey']) {
                clusterKey = req.headers['clusterkey'];
            } else if (req.body.clusterKey) {
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

            next();
        } catch (error) {
            ErrorService.log('serviceAuthorization.isAuthorizedService', error);
            throw error;
        }
    },
};
