/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const ProbeService = require('../services/probeService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const ErrorService = require('../services/errorService');
const CLUSTER_KEY = process.env.CLUSTER_KEY;
module.exports = {
    isAuthorizedProbe: async function(req, res, next) {
        try {
            let probeKey, probeName, clusterKey;

            if (req.params.probeKey) {
                probeKey = req.params.probeKey;
            } else if (req.query.probeKey) {
                probeKey = req.query.probeKey;
            } else if (req.headers['probeKey']) {
                probeKey = req.headers['probeKey'];
            } else if (req.headers['probekey']) {
                probeKey = req.headers['probekey'];
            } else if (req.body.probeKey) {
                probeKey = req.body.probeKey;
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Probe Key not found.',
                });
            }

            if (req.params.probeName) {
                probeName = req.params.probeName;
            } else if (req.query.probeName) {
                probeName = req.query.probeName;
            } else if (req.headers['probeName']) {
                probeName = req.headers['probeName'];
            } else if (req.headers['probename']) {
                probeName = req.headers['probename'];
            } else if (req.body.probeName) {
                probeName = req.body.probeName;
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Probe Name not found.',
                });
            }

            if (req.params.probeName) {
                probeName = req.params.probeName;
            } else if (req.query.probeName) {
                probeName = req.query.probeName;
            } else if (req.headers['probeName']) {
                probeName = req.headers['probeName'];
            } else if (req.headers['probename']) {
                probeName = req.headers['probename'];
            } else if (req.body.probeName) {
                probeName = req.body.probeName;
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Probe Name not found.',
                });
            }

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
            }

            let probe = await ProbeService.findOneBy({ probeKey, probeName });

            if (!probe && (!clusterKey || clusterKey !== CLUSTER_KEY)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Probe key and probe name do not match.',
                });
            }

            if (!probe) {
                //create a new probe.
                probe = await ProbeService.create({
                    probeKey,
                    probeName,
                });
            }

            req.probe = {};
            req.probe.id = probe._id;
            await ProbeService.updateProbeStatus(probe._id);
            next();
        } catch (error) {
            ErrorService.log('probeAuthorization.isAuthorizedProbe', error);
            throw error;
        }
    },
};
