import moment from 'moment';

const monitorCollection = global.db.collection('monitors');
import { ObjectId } from 'mongodb';

export default {
    updateCriterion: async function (
        _id: $TSFixMe,
        lastMatchedCriterion: $TSFixMe
    ) {
        await monitorCollection.updateOne(
            {
                _id: ObjectId(_id),
                $or: [{ deleted: false }, { deleted: { $exists: false } }],
            },
            { $set: { lastMatchedCriterion } }
        );
    },

    updateScanStatus: async function (monitorIds: $TSFixMe, status: $TSFixMe) {
        for (const id of monitorIds) {
            await monitorCollection.updateOne(
                {
                    _id: ObjectId(id),
                    $or: [{ deleted: false }, { deleted: { $exists: false } }],
                },
                {
                    $set: { scanning: status },
                }
            );
        }
    },

    addProbeScanning: async function (monitorIds: $TSFixMe, probeId: $TSFixMe) {
        for (const id of monitorIds) {
            await monitorCollection.updateOne(
                {
                    _id: ObjectId(id),
                    $or: [{ deleted: false }, { deleted: { $exists: false } }],
                },
                {
                    $push: { probeScanning: probeId },
                }
            );
        }
    },

    removeProbeScanning: async function (
        monitorIds: $TSFixMe,
        probeId: $TSFixMe
    ) {
        for (const id of monitorIds) {
            await monitorCollection.updateOne(
                {
                    _id: ObjectId(id),
                    $or: [{ deleted: false }, { deleted: { $exists: false } }],
                },
                {
                    $pull: { probeScanning: probeId },
                }
            );
        }
    },

    updateLighthouseScanStatus: async function (
        _id: $TSFixMe,
        lighthouseScanStatus: $TSFixMe,
        lighthouseScannedBy: $TSFixMe
    ) {
        const updateData = {};

        if (lighthouseScanStatus !== 'scanning') {
            updateData.lighthouseScannedAt = new Date(moment().format());

            updateData.lighthouseScannedBy = lighthouseScannedBy;
        } else {
            updateData.fetchLightHouse = null;
        }

        await monitorCollection.updateOne(
            {
                _id: ObjectId(_id),
                $or: [{ deleted: false }, { deleted: { $exists: false } }],
            },
            {
                $set: {
                    lighthouseScanStatus,
                    ...updateData,
                },
            }
        );
    },

    updateScriptStatus: async function (
        _id: $TSFixMe,
        scriptRunStatus: $TSFixMe,
        scriptRunBy: $TSFixMe
    ) {
        await monitorCollection.updateOne(
            {
                _id: ObjectId(_id),
                $or: [{ deleted: false }, { deleted: { $exists: false } }],
            },
            {
                $set: {
                    scriptRunStatus,
                    scriptRunBy,
                },
            }
        );
    },

    async findOneBy({ query }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        const monitor = await monitorCollection.findOne(query);
        return monitor;
    },

    async updateMonitorPingTime(id: $TSFixMe) {
        await monitorCollection.updateOne(
            {
                _id: ObjectId(id),
                $or: [{ deleted: false }, { deleted: { $exists: false } }],
            },
            { $set: { lastPingTime: new Date(moment().format()) } }
        );
        const monitor = await monitorCollection.findOne({
            _id: ObjectId(id),
            $or: [{ deleted: false }, { deleted: { $exists: false } }],
        });

        return monitor;
    },
};
