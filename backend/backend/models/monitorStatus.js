const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const monitorStatusSchema = new Schema({
    monitorId: { type: String, ref: 'Monitor' }, //which monitor does this belong to.
    probeId: { type: String, ref: 'Probe' }, //which probe does this belong to.
    incidentId: { type: String, ref: 'Incident' },
    status: String,
    manuallyCreated: {
        type: Boolean,
        default: false,
    },
    startTime: {
        type: Date,
        default: Date.now,
    },
    endTime: {
        type: Date,
        default: null,
    },
    lastStatus: String,
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('MonitorStatus', monitorStatusSchema);
