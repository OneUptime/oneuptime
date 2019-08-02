var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var monitorLogSchema = new Schema({
    monitorId: { type: String, ref: 'Monitor' }, //which monitor does this belong to.
    probeId: { type: String, ref: 'Probe' }, //which probe does this belong to.
    responseTime: Number, // Time taken for ping
    responseStatus: Number,
    status: String,
    createdAt: {
        type: Date,
        default: Date.now,
    }
});
module.exports = mongoose.model('MonitorLog', monitorLogSchema);
