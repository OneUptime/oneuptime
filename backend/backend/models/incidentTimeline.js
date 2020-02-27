const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const incidentTimelineSchema = new Schema({
    incidentId: { type: String, ref: 'Incident' },
    createdById: { type: String, ref: 'User' }, // userId
    probeId: { type: String, ref: 'Probe' }, // probeId

    createdByZapier: {
        type: Boolean,
        default: false,
    }, // is true when zapier creates incident

    createdAt: {
        type: Date,
        default: Date.now,
    },

    status: { type: String },
});
module.exports = mongoose.model('IncidentTimeline', incidentTimelineSchema);
