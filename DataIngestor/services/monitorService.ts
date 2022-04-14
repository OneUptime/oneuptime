import moment from 'moment';

const monitorCollection = global.db.collection('monitors');
import { ObjectId } from 'mongodb';

export default {
    updateCriterion: async function (
        _id: $TSFixMe,
        lastMatchedCriterion: $TSFixMe
    ): void {
        await monitorCollection.updateOne(
            {
                _id: ObjectId(_id),
                $or: [{ deleted: false }, { deleted: { $exists: false } }],
            },
            { $set: { lastMatchedCriterion } }
        );
    },

    updateScanStatus: async function (
        monitorIds: $TSFixMe,
        status: $TSFixMe
    ): void {
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

    addProbeScanning: async function (
        monitorIds: $TSFixMe,
        probeId: $TSFixMe
    ): void {
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
    ): void {
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
    ): void {
        const updateData: $TSFixMe = {};

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
    ): void {
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

    async findOneBy({ query }: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
        }

        const monitor = await monitorCollection.findOne(query);
        return monitor;
    },

    async updateMonitorPingTime(id: $TSFixMe): void {
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
