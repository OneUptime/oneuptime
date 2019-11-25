/**
 *
 * Copyright HackerBay, Inc.
 *
 */
var ProbeService = require('../services/probeService');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var ErrorService = require('../services/errorService');

module.exports = {
    isAuthorizedProbe: async function (req, res, next) {
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
                message: 'Probe Key not found.'
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
                message: 'Probe Name not found.'
            });
        }
        try {
            var probe = await ProbeService.findOneBy({ probeKey });
            if (probe && probe.probeName && probe.probeName === probeName) {
                req.probe = {};
                req.probe.id = probe._id;
                await ProbeService.updateProbeStatus(probe._id);
                next();
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Probe key and probe name do not match.'
                });
            }
        } catch (error) {
            ErrorService.log('isAuthorizedProbe', error);
            throw error;
        }
    }
};