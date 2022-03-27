import mongoose from '../utils/orm';

const Schema = mongoose.Schema;
const monitorLogByWeekSchema = new Schema({
    monitorId: { type: String, ref: 'Monitor', index: true }, // which monitor does this belong to.
    probeId: { type: String, ref: 'Probe' }, // which probe does this belong to.
    status: String, // current status based on criteria.
    responseTime: Number, // current time taken for ping.
    responseStatus: Number, // current status code of ping.
    cpuLoad: Number, // current cpu load.
    avgCpuLoad: Number, // current average cpu load from server.
    cpuCores: Number, // current number of cpu cores.
    memoryUsed: Number, // current memory used.
    totalMemory: Number, // current memory size.
    swapUsed: Number, // current swap memory used.
    storageUsed: Number, // current disk used.
    totalStorage: Number, // current disk size.
    storageUsage: Number, // current disk usage.
    mainTemp: Number, // current cpu temperature.
    maxTemp: Number, // current maximum cpu temperature from server.
    createdAt: {
        type: Date,
        default: Date.now,
    },
    intervalDate: { type: String, index: true }, // date of aggregate data (week)
    maxResponseTime: Number,
    maxCpuLoad: Number,
    maxMemoryUsed: Number,
    maxStorageUsed: Number,
    maxMainTemp: Number,
    sslCertificate: Object,
    kubernetesLog: Object,
});
export default mongoose.model('MonitorLogByWeek', monitorLogByWeekSchema);
