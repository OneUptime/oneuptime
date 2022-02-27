import ProbeService from '../services/probeService';
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
import ErrorService from '../services/errorService';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/config"' has no exported member ... Remove this comment to see the full error message
import { clusterKey as CLUSTER_KEY } from '../utils/config';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Global &... Remove this comment to see the full error message
global.probes = {};

export default {
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'req' implicitly has an 'any' type.
    isAuthorizedProbe: async function(req, res, next) {
        try {
            let probeKey, probeName, clusterKey, probeVersion;

            if (req.params && req.params.probeKey) {
                probeKey = req.params.probeKey;
            } else if (req.query && req.query.probeKey) {
                probeKey = req.query.probeKey;
            } else if (
                req.headers &&
                (req.headers['probeKey'] || req.headers['probekey'])
            ) {
                // header keys are automatically transformed to lowercase
                probeKey = req.headers['probeKey'] || req.headers['probekey'];
            } else if (req.body && req.body.probeKey) {
                probeKey = req.body.probeKey;
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Probe Key not found.',
                });
            }

            if (req.params && req.params.probeName) {
                probeName = req.params.probeName;
            } else if (req.query && req.query.probeName) {
                probeName = req.query.probeName;
            } else if (
                req.headers &&
                (req.headers['probeName'] || req.headers['probename'])
            ) {
                // header keys are automatically transformed to lowercase
                probeName =
                    req.headers['probeName'] || req.headers['probename'];
            } else if (req.body && req.body.probeName) {
                probeName = req.body.probeName;
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Probe Name not found.',
                });
            }

            if (req.params && req.params.clusterKey) {
                clusterKey = req.params.clusterKey;
            } else if (req.query && req.query.clusterKey) {
                clusterKey = req.query.clusterKey;
            } else if (
                req.headers &&
                (req.headers['clusterKey'] || req.headers['clusterkey'])
            ) {
                // header keys are automatically transformed to lowercase
                clusterKey =
                    req.headers['clusterKey'] || req.headers['clusterkey'];
            } else if (req.body && req.body.clusterKey) {
                clusterKey = req.body.clusterKey;
            }

            if (req.params && req.params.probeVersion) {
                probeVersion = req.params.probeVersion;
            } else if (req.query && req.query.probeVersion) {
                probeVersion = req.query.probeVersion;
            } else if (
                req.headers &&
                (req.headers['probeversion'] || req.headers['probeVersion'])
            ) {
                // header keys are automatically transformed to lowercase
                probeVersion =
                    req.headers['probeversion'] || req.headers['probeVersion'];
            } else if (req.body && req.body.probeVersion) {
                probeVersion = req.body.probeVersion;
            }

            let probeId = null;

            if (clusterKey && clusterKey === CLUSTER_KEY) {
                // if cluster key matches then just query by probe name,
                // because if the probe key does not match, we can update probe key later
                // without updating mognodb database manually.

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Global &... Remove this comment to see the full error message
                if (global.probes[probeName]) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Global &... Remove this comment to see the full error message
                    probeId = global.probes[probeName]._id;
                } else {
                    const probe = await ProbeService.findOneBy({ probeName });

                    if (probe && probe._id) {
                        probeId = probe._id;
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Global &... Remove this comment to see the full error message
                        global.probes[probeName] = {
                            _id: probe._id,
                            probeKey: probe.probeKey,
                            version: probe.version,
                        };
                    }
                }
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Global &... Remove this comment to see the full error message
                if (global.probes[probeName]) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Global &... Remove this comment to see the full error message
                    probeId = global.probes[probeName]._id;
                } else {
                    const probe = await ProbeService.findOneBy({
                        probeKey,
                        probeName,
                    });

                    if (probe && probe._id) {
                        probeId = probe._id;
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Global &... Remove this comment to see the full error message
                        global.probes[probeName] = {
                            _id: probe._id,
                            probeKey: probe.probeKey,
                            version: probe.version,
                        };
                    }
                }
            }

            if (!probeId && (!clusterKey || clusterKey !== CLUSTER_KEY)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Probe key and probe name do not match.',
                });
            }

            if (!probeId) {
                //create a new probe.
                const probe = await ProbeService.create({
                    probeKey,
                    probeName,
                    probeVersion,
                });

                probeId = probe._id;

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Global &... Remove this comment to see the full error message
                global.probes[probeName] = {
                    _id: probe._id,
                    probeKey: probe.probeKey,
                    version: probe.version,
                };
            }

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Global &... Remove this comment to see the full error message
            if (global.probes[probeName].probeKey !== probeKey) {
                //update probe key becasue it does not match.
                await ProbeService.updateOneBy(
                    {
                        probeName,
                    },
                    { probeKey }
                );

                const probe = await ProbeService.findOneBy({
                    probeKey,
                    probeName,
                });

                probeId = probe._id;

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Global &... Remove this comment to see the full error message
                global.probes[probeName] = {
                    _id: probe._id,
                    probeKey: probe.probeKey,
                    version: probe.version,
                };
            }

            req.probe = {};
            req.probe.id = probeId.toString();

            // run in background.
            ProbeService.updateProbeStatus(probeId);

            if (
                probeVersion &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Global &... Remove this comment to see the full error message
                (!global.probes[probeName].version ||
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Global &... Remove this comment to see the full error message
                    global.probes[probeName].version !== probeVersion)
            ) {
                await ProbeService.updateOneBy(
                    {
                        probeName,
                    },
                    { version: probeVersion }
                );
            }

            return next();
        } catch (error) {
            ErrorService.log('probeAuthorization.isAuthorizedProbe', error);
            throw error;
        }
    },
};
