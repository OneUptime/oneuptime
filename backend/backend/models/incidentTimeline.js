const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const incidentTimelineSchema = new Schema({
    incidentId: { type: String, ref: 'Incident', index: true, },
    createdById: { type: String, ref: 'User', index: true, }, // userId
    probeId: { type: String, ref: 'Probe', index: true, }, // probeId

    createdByZapier: {
        type: Boolean,
        default: false,
    }, // is true when zapier creates incident

    createdAt: {
        type: Date,
        default: Date.now,
    },

    status: { type: String },
    incident_state: String,

    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('IncidentTimeline', incidentTimelineSchema);
