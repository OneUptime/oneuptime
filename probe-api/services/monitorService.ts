import ErrorService from './errorService';
import moment from 'moment';
import Database from 'common-server/utils/database';

const monitorCollection = Database.getDatabase().collection('monitors');

export default {
    async getProbeMonitors(probeId: String, limit: Number = 10) {
        //get monitors that have not been pinged for the last minute.
        const date = new Date(new Date().getTime() - 60 * 1000);

        if (typeof limit === 'string') {
            limit = Number(limit);
        }

        const key = `${probeId}_pingtime`;

        const emptyQuery = {
            deleted: false,
            disabled: false,
            type: {
                $in: ['url', 'api'],
            },
            [key]: { $exists: false },
        };

        const query = {
            deleted: false,
            disabled: false,
            type: {
                $in: [
                    'url',
                    'api',
                    'incomingHttpRequest',
                    'kubernetes',
                    'ip',
                    'server-monitor',
                ],
            },
            [key]: { $lt: date },
        };

        try {
            let monitors: $TSFixMe = [];

            const monitorsThatHaveNeverBeenPinged = await monitorCollection
                .find(emptyQuery)
                .limit(limit)
                .toArray();
            monitors = monitors.concat(monitorsThatHaveNeverBeenPinged);

            if (monitorsThatHaveNeverBeenPinged.length < limit) {
                const monitorsThatHaveBeenPingedBeforeOneMinute = await monitorCollection
                    .find(query)
                    .sort({ [key]: 1 })
                    .limit(limit)
                    .toArray();
                monitors = monitors.concat(
                    monitorsThatHaveBeenPingedBeforeOneMinute
                );
            }

            if (monitors && monitors.length > 0) {
                await monitorCollection.updateMany(
                    { _id: { $in: monitors.map(monitor => monitor._id) } },
                    { $set: { [key]: new Date(moment().format()) } }
                );

                return monitors;
            } else {
                return [];
            }
        } catch (error) {
            ErrorService.log('monitorService.getProbeMonitors', error);
            throw error;
        }
    },
};
