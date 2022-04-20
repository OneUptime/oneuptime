import ProbeService from '../Services/probeService';
import { sendErrorResponse } from 'CommonServer/utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'CommonServer/utils/Express';

import { clusterKey as CLUSTER_KEY } from '../Config';

global.probes = {};

export default {
    isAuthorizedProbe: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        let probeKey: $TSFixMe,
            probeName: $TSFixMe,
            clusterKey: $TSFixMe,
            probeVersion: $TSFixMe;

        if (req.params && req.params['probeKey']) {
            probeKey = req.params['probeKey'];
        } else if (req.query && req.query['probeKey']) {
            probeKey = req.query['probeKey'];
        } else if (
            req.headers &&
            (req.headers.probeKey || req.headers.probekey)
        ) {
            // Header keys are automatically transformed to lowercase
            probeKey = req.headers.probeKey || req.headers.probekey;
        } else if (req.body && req.body.probeKey) {
            probeKey = req.body.probeKey;
        } else {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Probe Key not found.')
            );
        }

        if (req.params && req.params['probeName']) {
            probeName = req.params['probeName'];
        } else if (req.query && req.query['probeName']) {
            probeName = req.query['probeName'];
        } else if (
            req.headers &&
            (req.headers.probeName || req.headers.probename)
        ) {
            // Header keys are automatically transformed to lowercase
            probeName = req.headers.probeName || req.headers.probename;
        } else if (req.body && req.body.probeName) {
            probeName = req.body.probeName;
        } else {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Probe Name not found.')
            );
        }

        if (req.params && req.params['clusterKey']) {
            clusterKey = req.params['clusterKey'];
        } else if (req.query && req.query['clusterKey']) {
            clusterKey = req.query['clusterKey'];
        } else if (
            req.headers &&
            (req.headers.clusterKey || req.headers.clusterkey)
        ) {
            // Header keys are automatically transformed to lowercase
            clusterKey = req.headers.clusterKey || req.headers.clusterkey;
        } else if (req.body && req.body.clusterKey) {
            clusterKey = req.body.clusterKey;
        }

        if (req.params && req.params['probeVersion']) {
            probeVersion = req.params['probeVersion'];
        } else if (req.query && req.query['probeVersion']) {
            probeVersion = req.query['probeVersion'];
        } else if (
            req.headers &&
            (req.headers.probeversion || req.headers.probeVersion)
        ) {
            // Header keys are automatically transformed to lowercase
            probeVersion = req.headers.probeversion || req.headers.probeVersion;
        } else if (req.body && req.body.probeVersion) {
            probeVersion = req.body.probeVersion;
        }

        let probeId: $TSFixMe = null;

        if (clusterKey && clusterKey === CLUSTER_KEY) {
            /*
             * If cluster key matches then just query by probe name,
             * Because if the probe key does not match, we can update probe key later
             * Without updating mognodb database manually.
             */

            if (global.probes[probeName]) {
                probeId = global.probes[probeName]._id;
            } else {
                const probe: $TSFixMe = await ProbeService.findOneBy({
                    probeName,
                });

                if (probe && probe._id) {
                    probeId = probe._id;

                    global.probes[probeName] = {
                        _id: probe._id,
                        probeKey: probe.probeKey,
                        version: probe.version,
                    };
                }
            }
        } else if (global.probes[probeName]) {
            probeId = global.probes[probeName]._id;
        } else {
            const probe: $TSFixMe = await ProbeService.findOneBy({
                probeKey,
                probeName,
            });

            if (probe && probe._id) {
                probeId = probe._id;

                global.probes[probeName] = {
                    _id: probe._id,
                    probeKey: probe.probeKey,
                    version: probe.version,
                };
            }
        }

        if (!probeId && (!clusterKey || clusterKey !== CLUSTER_KEY)) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Probe key and probe name do not match.')
            );
        }

        if (!probeId) {
            //Create a new probe.
            const probe: $TSFixMe = await ProbeService.create({
                probeKey,
                probeName,
                probeVersion,
            });

            probeId = probe._id;

            global.probes[probeName] = {
                _id: probe._id,
                probeKey: probe.probeKey,
                version: probe.version,
            };
        }

        if (global.probes[probeName].probeKey !== probeKey) {
            //Update probe key becasue it does not match.
            await ProbeService.updateOneBy(
                {
                    probeName,
                },
                { probeKey }
            );

            const probe: $TSFixMe = await ProbeService.findOneBy({
                probeKey,
                probeName,
            });

            probeId = probe._id;

            global.probes[probeName] = {
                _id: probe._id,
                probeKey: probe.probeKey,
                version: probe.version,
            };
        }

        req.probe = {};
        req.probe.id = probeId.toString();

        // Run in background.
        ProbeService.updateProbeStatus(probeId);

        if (
            probeVersion &&
            (!global.probes[probeName].version ||
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
    },
};
