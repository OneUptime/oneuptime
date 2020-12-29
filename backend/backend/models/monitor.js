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
        enum: [
            'url',
            'device',
            'manual',
            'api',
            'server-monitor',
            'script',
            'incomingHttpRequest',
        ],
    }, //type can be 'url', 'process', 'machine'. We can monitor URL, a process in a machine or a server itself.
    agentlessConfig: Object,
    resourceCategory: {
        type: String,
        ref: 'ResourceCategory',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    pollTime: {
        type: Array,
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
    disabled: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User' },
    scriptRunStatus: String,
    scriptRunBy: { type: String, ref: 'Probe' },

    lighthouseScannedAt: { type: Date },
    lighthouseScanStatus: String,
    lighthouseScannedBy: { type: String, ref: 'Probe' },
    siteUrls: [String],
    incidentCommunicationSla: {
        type: Schema.Types.ObjectId,
        ref: 'IncidentCommunicationSla',
    },
    monitorSla: {
        type: Schema.Types.ObjectId,
        ref: 'MonitorSla',
    },
    breachedMonitorSla: { type: Boolean, default: false },
    breachClosedBy: [{ type: String, ref: 'User' }],
    thirdPartyVariable: [String],
});

monitorSchema.virtual('project', {
    localField: '_id',
    foreignField: 'projectId',
    ref: 'Project',
    justOne: true,
});

module.exports = mongoose.model('Monitor', monitorSchema);
