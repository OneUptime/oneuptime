const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const monitorSchema = new Schema({
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
    }, //which project this monitor belongs to.
    componentId: {
        type: Schema.Types.ObjectId,
        ref: 'Component',
    },
    name: String,
    data: Object, //can be URL, IP address, or anything that depends on the type.
    createdById: { type: String, ref: 'User' }, //userId.
    type: {
        type: String,
        enum: ['url', 'device', 'manual', 'api', 'server-monitor', 'script'],
    }, //type can be 'url', 'process', 'machine'. We can monitor URL, a process in a machine or a server itself.
    monitorCategoryId: {
        type: String,
        ref: 'MonitorCategory',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    pollTime: {
        type: Date,
        default: Date.now,
    },
    lastPingTime: {
        type: Date,
        default: Date.now,
    },
    updateTime: {
        type: Date,
        default: Date.now,
    },
    criteria: Object,
    method: String,
    bodyType: String,
    formData: [Object],
    text: String,
    headers: [Object],
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User' },

    lighthouseScannedAt: { type: Date },
    lighthouseScanStatus: String,
    lighthouseScannedBy: { type: String, ref: 'Probe' },
    lighthouseScores: Object,
});

monitorSchema.virtual('project', {
    localField: '_id',
    foreignField: 'projectId',
    ref: 'Project',
    justOne: true,
});

module.exports = mongoose.model('Monitor', monitorSchema);
