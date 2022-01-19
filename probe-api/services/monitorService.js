module.exports = {
    async getProbeMonitors(probeId, limit = 10) {
        //get monitors that have not been pinged for the last minute.
        const date = new Date(new Date().getTime() - 60 * 1000);

        if (typeof limit === 'string') {
            limit = Number(limit);
        }

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
                    regions: {
                        $not: {
                            $elemMatch: {
                                probeId,
                            },
                        },
                    },
                },
                {
                    regions: {
                        $elemMatch: {
                            probeId,
                            lastPingTime: {
                                $lt: date,
                            },
                        },
                    },
                },
            ],
        };
        try {
            const monitors = await monitorCollection
                .aggregate([
                    { $match: query },
                    {
                        $addFields: {
                            regionLastPingTime: {
                                $filter: {
                                    input: '$regions',
                                    as: 'region',
                                    cond: {
                                        $eq: [
                                            '$$region.probeId',
                                            ObjectId(probeId),
                                        ],
                                    },
                                },
                            },
                        },
                    },
                    {
                        $addFields: {
                            regionLastPingTime: {
                                $cond: {
                                    if: {
                                        $anyElementTrue: [
                                            '$regionLastPingTime',
                                        ],
                                    },
                                    then: '$regionLastPingTime',
                                    else: [{ lastPingTime: 0 }],
                                },
                            },
                        },
                    },
                    {
                        $sort: {
                            'regionLastPingTime.lastPingTime': 1,
                        },
                    },
                    { $limit: limit },
                ])
                .toArray();

            if (monitors && monitors.length > 0) {
                for (const monitor of monitors) {
                    const newdate = new Date(moment().format());
                    let updated = false;
                    const regions = monitor.regions.map(region => {
                        if (String(region.probeId) === String(probeId)) {
                            updated = true;
                            region.lastPingTime = newdate;
                        }
                        return region;
                    });
                    if (!updated) {
                        regions.push({
                            probeId,
                            lastPingTime: newdate,
                        });
                    }

                    await monitorCollection.updateOne(
                        { _id: monitor._id },
                        { $set: { regions } }
                    );
                }

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
