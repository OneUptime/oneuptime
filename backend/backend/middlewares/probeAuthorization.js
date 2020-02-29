/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const ProbeService = require('../services/probeService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const ErrorService = require('../services/errorService');

module.exports = {
    isAuthorizedProbe: async function(req, res, next) {
        try {
            let probeKey, probeName;

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
            let probe = await ProbeService.findOneBy({ probeKey, probeName });
            if (probe) {
                req.probe = {};
                req.probe.id = probe._id;
                await ProbeService.updateProbeStatus(probe._id);
                next();
            } else {
                if (probeKey === 'test-key') {
                    probe = await ProbeService.create({ probeKey, probeName });
                    req.probe = {};
                    req.probe.id = probe._id;
                    await ProbeService.updateProbeStatus(probe._id);
                    next();
                } else {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Probe key and probe name do not match.',
                    });
                }
            }
        } catch (error) {
            ErrorService.log('probeAuthorization.isAuthorizedProbe', error);
            throw error;
        }
    },
};
