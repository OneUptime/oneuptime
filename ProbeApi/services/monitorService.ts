import moment from 'moment';
import Database from 'CommonServer/Utils/database';
import PositiveNumber from 'Common/Types/PositiveNumber';
import OneUptimeDate from 'Common/Types/Date';

const monitorCollection: $TSFixMe =
    Database.getDatabase().collection('monitors');

export default {
    async getProbeMonitors(probeId: String, limit: PositiveNumber): void {
        //get monitors that have not been pinged for the last minute.
        const date: $TSFixMe = OneUptimeDate.getOneMinAgo();

        const key: string = `${probeId}_pingtime`;

        const emptyQuery: $TSFixMe = {
            deleted: false,
            disabled: false,
            type: {
                $in: ['url', 'api'],
            },
            [key]: { $exists: false },
        };

        const query: $TSFixMe = {
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

        const monitorsThatHaveNeverBeenPinged: $TSFixMe =
            await monitorCollection.find(emptyQuery).limit(limit).toArray();
        monitors = monitors.concat(monitorsThatHaveNeverBeenPinged);

        if (monitorsThatHaveNeverBeenPinged.length < limit) {
            const monitorsThatHaveBeenPingedBeforeOneMinute: $TSFixMe =
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
                {
                    _id: {
                        $in: monitors.map((monitor: $TSFixMe) => {
                            return monitor._id;
                        }),
                    },
                },
                { $set: { [key]: new Date(moment().format()) } }
            );

            return monitors;
        } else {
            return [];
        }
    },
};
