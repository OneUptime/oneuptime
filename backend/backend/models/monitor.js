const mongoose = require('../config/db');

// a schema definition for a criterion event, i.e up, down, or degraded
const criterionEventSchema = {
    scheduleIds: [String],
    createAlert: { type: Boolean, default: false },
    autoAcknowledge: { type: Boolean, default: false },
    autoResolve: { type: Boolean, default: false },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    and: [Object],
    or: [Object],
    default: { type: Boolean, default: false },
    name: String,
};

const Schema = mongoose.Schema;
const monitorSchema = new Schema({
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    }, //which project this monitor belongs to.
    componentId: {
        type: Schema.Types.ObjectId,
        ref: 'Component',
        index: true,
    },
    name: String,
    data: Object, //can be URL, IP address, or anything that depends on the type.
    createdById: { type: String, ref: 'User', index: true }, //userId.
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
    criteria: {
        up: { type: [criterionEventSchema], default: [] },
        degraded: { type: [criterionEventSchema], default: [] },
        down: { type: [criterionEventSchema], default: [] },
    },
    lastMatchedCriterion: { type: criterionEventSchema, default: {} },
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
    customFields: [{ fieldName: String, fieldValue: Schema.Types.Mixed }],
});

monitorSchema.virtual('project', {
    localField: '_id',
    foreignField: 'projectId',
    ref: 'Project',
    justOne: true,
});

module.exports = mongoose.model('Monitor', monitorSchema);
