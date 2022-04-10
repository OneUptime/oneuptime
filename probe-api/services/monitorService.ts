import moment from 'moment';
import Database from 'common-server/utils/database';
import PositiveNumber from 'common/Types/PositiveNumber';
import OneUptimeDate from 'common/Types/Date';

const monitorCollection = Database.getDatabase().collection('monitors');

export default {
    async getProbeMonitors(probeId: String, limit: PositiveNumber) {
        //get monitors that have not been pinged for the last minute.
        const date = OneUptimeDate.getOneMinAgo();

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

        let monitors: $TSFixMe = [];

        const monitorsThatHaveNeverBeenPinged = await monitorCollection
            .find(emptyQuery)
            .limit(limit)
            .toArray();
        monitors = monitors.concat(monitorsThatHaveNeverBeenPinged);

        if (monitorsThatHaveNeverBeenPinged.length < limit) {
            const monitorsThatHaveBeenPingedBeforeOneMinute =
                await monitorCollection
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
    },
};
