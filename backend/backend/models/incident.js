var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var monitorSchema = new Schema({
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', alias: 'project' }, //which project this incident belongs to.
    monitorId: { type: String, ref: 'Monitor' }, // which monitor does this incident belongs to.

    acknowledged: {
        type: Boolean,
        default: false,
    },
    acknowledgedBy: { type: String, ref: 'User' }, // userId
    acknowledgedAt: {
        type: Date
    },
    acknowledgedByZapier: {
        type: Boolean,
        default: false,
    }, // is true when zapier acknowledges incident

    resolved: {
        type: Boolean,
        default: false,
    },
    incidentType: {
        type: String,
        enum: ['online', 'offline', 'degraded'],
        required: false
    },
    probes: [
        {
            probeId: { type: String, ref: 'Probe' },
            updatedAt: { type: Date },
            status: { type: Boolean, default: true }
        }
    ],
    resolvedBy: { type: String, ref: 'User' }, // userId
    resolvedAt: { type: Date },
    resolvedByZapier: {
        type: Boolean,
        default: false,
    }, // is true when zapier resolves incident

    internalNote: { type: String, default: '' },
    investigationNote: { type: String, default: '' },

    createdById: { type: String, ref: 'User' }, // userId

    createdAt: {
        type: Date,
        default: Date.now,
    },

    createdByZapier: {
        type: Boolean,
        default: false,
    }, // is true when zapier creates incident

    notClosedBy: [{ type: String, ref: 'User' }],
    manuallyCreated: { type: Boolean, default: false },

    deleted: { type: Boolean, default: false, select: false },

    deletedAt: {
        type: Date,
        select: false
    },

    deletedById: { type: String, ref: 'User', select: false },
    __v: { type: Number, select: false }
});
module.exports = mongoose.model('Incident', monitorSchema);