module.exports = {
    updateCriterion: async function(_id, lastMatchedCriterion) {
        await monitorCollection.updateOne(
            { _id: ObjectId(_id) },
            { $set: { lastMatchedCriterion } }
        );
    },

    updateLighthouseScanStatus: async function(
        _id,
        lighthouseScanStatus,
        lighthouseScannedBy
    ) {
        const updateData = {};

        if (lighthouseScanStatus !== 'scanning') {
            updateData.lighthouseScannedAt = new Date(moment().format());
            updateData.lighthouseScannedBy = lighthouseScannedBy;
        } else {
            updateData.fetchLightHouse = null;
        }

        await monitorCollection.updateOne(
            { _id: ObjectId(_id) },
            {
                $set: {
                    lighthouseScanStatus,
                    ...updateData,
                },
            }
        );
    },

    updateScriptStatus: async function(_id, scriptRunStatus, scriptRunBy) {
        await monitorCollection.updateOne(
            { _id: ObjectId(_id) },
            {
                $set: {
                    scriptRunStatus,
                    scriptRunBy,
                },
            }
        );
    },

    async findOneBy({ query }) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            const monitor = await monitorCollection.findOne(query);
            return monitor;
        } catch (error) {
            ErrorService.log('monitorService.findOneBy', error);
            throw error;
        }
    },

    async getProbeMonitors(probeId, date) {
        try {
            const newdate = new Date(moment().format());
            const monitors = await monitorCollection
                .find({
                    $and: [
                        {
                            deleted: false,
                            disabled: false,
                        },
                        {
                            $or: [
                                {
                                    // This block only applies to server-monitors.
                                    $and: [
                                        {
                                            type: {
                                                $in: ['server-monitor'],
                                            },
                                        },
                                        {
                                            $or: [
                                                {
                                                    pollTime: { $size: 0 },
                                                },
                                                {
                                                    //Avoid monitors that has been pinged during the last interval of time.
                                                    pollTime: {
                                                        $not: {
                                                            $elemMatch: {
                                                                date: {
                                                                    $gt: date,
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    $and: [
                                        {
                                            type: {
                                                $in: [
                                                    'url',
                                                    'api',
                                                    'incomingHttpRequest',
                                                    'kubernetes',
                                                    'ip',
                                                ],
                                            },
                                        },
                                        {
                                            $or: [
                                                {
                                                    pollTime: {
                                                        $elemMatch: {
                                                            probeId,
                                                            date: { $lt: date },
                                                        },
                                                    },
                                                },
                                                {
                                                    //pollTime doesn't include the probeId yet.
                                                    pollTime: {
                                                        $not: {
                                                            $elemMatch: {
                                                                probeId,
                                                            },
                                                        },
                                                    },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                })
                .toArray();

            if (monitors && monitors.length) {
                const updatePromises = [];
                const createNewPollTimeMonitorIds = [];
                const updatePollTimeMonitorIds = [];

                for (const monitor of monitors) {
                    if (
                        monitor.pollTime.length === 0 ||
                        !monitor.pollTime.some(
                            pt => String(pt.probeId) === String(probeId)
                        )
                    ) {
                        createNewPollTimeMonitorIds.push(ObjectId(monitor._id));
                    } else {
                        updatePollTimeMonitorIds.push(ObjectId(monitor._id));
                    }
                }

                updatePromises.push(
                    monitorCollection.updateMany(
                        { _id: { $in: createNewPollTimeMonitorIds } },
                        {
                            $push: {
                                pollTime: { probeId, date: newdate },
                            },
                        }
                    )
                );

                updatePromises.push(
                    monitorCollection.updateMany(
                        {
                            _id: { $in: updatePollTimeMonitorIds },
                            pollTime: {
                                $elemMatch: {
                                    probeId,
                                },
                            },
                        },
                        { $set: { 'pollTime.$.date': newdate } }
                    )
                );

                await Promise.all(updatePromises);

                return monitors;
            } else {
                return [];
            }
        } catch (error) {
            ErrorService.log('monitorService.getProbeMonitors', error);
            throw error;
        }
    },

    async updateMonitorPingTime(id) {
        try {
            await monitorCollection.updateOne(
                {
                    _id: ObjectId(id),
                },
                { $set: { lastPingTime: new Date(moment().format()) } }
            );
            const monitor = await monitorCollection.findOne({
                _id: ObjectId(id),
            });

            return monitor;
        } catch (error) {
            ErrorService.log('monitorService.updateMonitorPingTime', error);
            throw error;
        }
    },
};

const ErrorService = require('./errorService');
const moment = require('moment');
const monitorCollection = global.db.collection('monitors');
const { ObjectId } = require('mongodb');
