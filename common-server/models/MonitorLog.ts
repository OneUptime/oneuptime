import mongoose, { RequiredFields, UniqueFields } from '../infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    monitorId: { type: String, ref: 'Monitor', index: true }, // which monitor does this belong to.
    probeId: { type: String, ref: 'Probe', index: true }, // which probe does this belong to.
    status: String, // status based on criteria.
    responseTime: Number, // time taken for ping.
    responseStatus: Number, // status code of ping.
    responseBody: String, //response body of ping
    responseHeader: Object, //response header(s) of ping
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
    incidentIds: [{ type: String, ref: 'Incident', index: true }],
    createdAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
    sslCertificate: Object,
    kubernetesLog: Object,
    scriptMetadata: {
        executionTime: Number,
        consoleLogs: [String],
        error: String,
        statusText: String,
    },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];

export const sligifyField: string = '';

export default mongoose.model('MonitorLog', schema);
