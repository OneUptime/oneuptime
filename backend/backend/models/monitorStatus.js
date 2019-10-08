var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var monitorStatusSchema = new Schema({
    monitorId: { type: String, ref: 'Monitor' }, //which monitor does this belong to.
    probeId: { type: String, ref: 'Probe' }, //which probe does this belong to.
    responseTime: Number, // Time taken for ping
    status: String,
    manuallyCreated: {
        type: Boolean,
        default: false
    },
    startTime: {
        type: Date,
        default: Date.now,
    },
    endTime: {
        type: Date,
        default: null,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    }
});
module.exports = mongoose.model('MonitorStatus', monitorStatusSchema);