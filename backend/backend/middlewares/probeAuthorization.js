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
            let probeKey, probeName, clusterKey, probeVersion;

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

            if (req.params.probeVersion) {
                probeVersion = req.params.probeVersion;
            } else if (req.query.probeVersion) {
                probeVersion = req.query.probeVersion;
            } else if (req.headers['probeversion']) {
                probeVersion = req.headers['probeversion'];
            } else if (req.body.probeVersion) {
                probeVersion = req.body.probeVersion;
            }

            let probe = null;

            if (clusterKey && clusterKey === CLUSTER_KEY) {
                // if cluster key matches then just query by probe name,
                // because if the probe key does not match, we can update probe key later
                // without updating mognodb database manually.
                probe = await ProbeService.findOneBy({ probeName });
            } else {
                probe = await ProbeService.findOneBy({ probeKey, probeName });
            }

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
                    probeVersion,
                });
            }

            if (probe.probeKey !== probeKey) {
                //update probe key becasue it does not match.
                await ProbeService.updateOneBy(
                    {
                        probeName,
                    },
                    { probeKey }
                );
            }
            req.probe = {};
            req.probe.id = probe._id;
            await ProbeService.updateProbeStatus(probe._id);

            //Update probe version
            const probeValue = await ProbeService.findOneBy({
                probeKey,
                probeName,
            });

            if (!probeValue.version || probeValue.version !== probeVersion) {
                await ProbeService.updateOneBy(
                    {
                        probeName,
                    },
                    { version: probeVersion }
                );
            }

            next();
        } catch (error) {
            ErrorService.log('probeAuthorization.isAuthorizedProbe', error);
            throw error;
        }
    },
};
