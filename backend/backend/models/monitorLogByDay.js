var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var monitorLogByDaySchema = new Schema({
    monitorId: { type: String, ref: 'Monitor' }, //which monitor does this belong to.
    probeId: { type: String, ref: 'Probe' }, //which probe does this belong to.
    responseTime: Number, // Time taken for ping
    responseStatus: Number,
    status: String,
    data: Object,
    createdAt: {
        type: Date,
        default: Date.now,
    },
    intervalDate: String,
    avgResponseTime: Number,
    avgCpuLoad: Number,
    avgMemoryUsed: Number,
    avgStorageUsed: Number,
    avgMainTemp: Number,
    count: Number
});
module.exports = mongoose.model('MonitorLogByDay', monitorLogByDaySchema);
