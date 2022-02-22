module.exports = {
    async getProbeMonitors(probeId, limit = 10) {
        //get monitors that have not been pinged for the last minute.
        const date = new Date(new Date().getTime() - 60 * 1000);

        if (typeof limit === 'string') {
            limit = Number(limit);
        }

        const key = `${probeId}_pingtime`;

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
            $or: [
                {
                    // regions does not include the probeId yet
                    [key]: { $exists: false },
                },
                {
                    // regions does not include the probeId yet
                    [key]: { $lt: date },
                },
            ],
        };
        try {
            const monitors = await monitorCollection.find(query).limit(limit).toArray();

            if (monitors && monitors.length > 0) {
                await monitorCollection.updateMany(
                    { _id: { $in: monitors.map((monitor) => monitor._id) } },
                    { $set: { key: new Date(moment().format()) } }
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

const ErrorService = require('./errorService');
const moment = require('moment');
const monitorCollection = global.db.collection('monitors');
const { ObjectId } = require('mongodb');
