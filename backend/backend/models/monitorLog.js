const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const monitorLogSchema = new Schema({
    monitorId: { type: String, ref: 'Monitor' }, // which monitor does this belong to.
    probeId: { type: String, ref: 'Probe' }, // which probe does this belong to.
    status: String, // status based on criteria.
    responseTime: Number, // time taken for ping.
    responseStatus: Number, // status code of ping.
    cpuLoad: Number, // cpu load.
    avgCpuLoad: Number, // average cpu load from server.
    cpuCores: Number, // number of cpu cores.
    memoryUsed: Number, // memory used.
    totalMemory: Number, // memory size.
    swapUsed: Number, // swap memory used.
    storageUsed: Number, // disk used.
    totalStorage: Number, // disk size.
    storageUsage: Number, // disk usage.
    mainTemp: Number, // cpu temperature.
    maxTemp: Number, // maximum cpu temperature from server.
    incidentIds: [
        { type: String, ref: 'Incident' }
    ],
    createdAt: {
        type: Date,
        default: Date.now,
    }
});
module.exports = mongoose.model('MonitorLog', monitorLogSchema);
