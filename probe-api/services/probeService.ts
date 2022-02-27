export default {
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
    create: async function(data) {
        try {
            const _this = this;
            let probeKey;
            if (data.probeKey) {
                probeKey = data.probeKey;
            } else {
                probeKey = uuidv1();
            }
            const storedProbe = await _this.findOneBy({
                probeName: data.probeName,
            });
            if (storedProbe && storedProbe.probeName) {
                const error = new Error('Probe name already exists.');
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
                error.code = 400;
                ErrorService.log('probe.create', error);
                throw error;
            } else {
                const probe = {};
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeKey' does not exist on type '{}'.
                probe.probeKey = probeKey;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeName' does not exist on type '{}'.
                probe.probeName = data.probeName;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'version' does not exist on type '{}'.
                probe.version = data.probeVersion;

                const now = new Date(moment().format());
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdAt' does not exist on type '{}'.
                probe.createdAt = now;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lastAlive' does not exist on type '{}'.
                probe.lastAlive = now;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleted' does not exist on type '{}'.
                probe.deleted = false;

                const result = await probeCollection.insertOne(probe);
                const savedProbe = await _this.findOneBy({
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    _id: ObjectId(result.insertedId),
                });
                return savedProbe;
            }
        } catch (error) {
            ErrorService.log('ProbeService.create', error);
            throw error;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            const probe = await probeCollection.findOne(query);
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.findOneBy', error);
            throw error;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            await probeCollection.updateOne(query, { $set: data });
            const probe = await this.findOneBy(query);
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.updateOneBy', error);
            throw error;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'probeId' implicitly has an 'any' type.
    updateProbeStatus: async function(probeId) {
        try {
            const now = new Date(moment().format());
            await probeCollection.updateOne(
                {
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    _id: ObjectId(probeId),
                    $or: [{ deleted: false }, { deleted: { $exists: false } }],
                },
                { $set: { lastAlive: now } }
            );
            const probe = await this.findOneBy({
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                _id: ObjectId(probeId),
            });

            // realtime update for probe
            postApi(
                `${realtimeBaseUrl}/update-probe`,
                { data: probe },
                true
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'error' implicitly has an 'any' type.
            ).catch(error => {
                ErrorService.log('probeService.updateProbeStatus', error);
            });
            return probe;
        } catch (error) {
            ErrorService.log('probeService.updateProbeStatus', error);
            throw error;
        }
    },
};

import ErrorService from './errorService';
import moment from 'moment';
import { ObjectId } from 'mongodb';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
const probeCollection = global.db.collection('probes');
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v1 as uuidv1 } from 'uuid';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/api"' has no exported member 'po... Remove this comment to see the full error message
import { postApi } from '../utils/api';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/config"' has no exported member ... Remove this comment to see the full error message
import { realtimeUrl } from '../utils/config';
const realtimeBaseUrl = `${realtimeUrl}/realtime`;
