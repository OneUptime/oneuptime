/**
 *
 * Copyright HackerBay, Inc.
 *
 */
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const EnvClusterKey = require('../config/keys').clusterKey;

module.exports = {
    isAuthorizedAdmin: async function (req, res, next) {
        let clusterKey;
        let masterAdmin = false;

        if (req.params.clusterKey) {
            clusterKey = req.params.clusterKey;
        } else if (req.query.clusterKey) {
            clusterKey = req.query.clusterKey;
        } else if (req.headers['clusterKey']) {
            clusterKey = req.headers['clusterKey'];
        } else if (req.body.clusterKey) {
            clusterKey = req.body.clusterKey;
        }else if (req.authorizationType === 'MASTER-ADMIN') {
            masterAdmin = true;
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Cluster Key not found.'
            });
        }
        if ((clusterKey && EnvClusterKey && EnvClusterKey === clusterKey) || masterAdmin) {
            next();
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Invalid cluster key.'
            });
        }
    },

};