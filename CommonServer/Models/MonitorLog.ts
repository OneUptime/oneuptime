import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
   Schema
} from '../Infrastructure/ORM';


const schema: Schema = new Schema({
    monitorId: { type: String, ref: 'Monitor', index: true }, // Which monitor does this belong to.
    probeId: { type: String, ref: 'Probe', index: true }, // Which probe does this belong to.
    status: String, // Status based on criteria.
    responseTime: Number, // Time taken for ping.
    responseStatus: Number, // Status code of ping.
    responseBody: String, //Response body of ping
    responseHeader: Object, //Response header(s) of ping
    cpuLoad: Number, // Cpu load.
    avgCpuLoad: Number, // Average cpu load from server.
    cpuCores: Number, // Number of cpu cores.
    memoryUsed: Number, // Memory used.
    totalMemory: Number, // Memory size.
    swapUsed: Number, // Swap memory used.
    storageUsed: Number, // Disk used.
    totalStorage: Number, // Disk size.
    storageUsage: Number, // Disk usage.
    mainTemp: Number, // Cpu temperature.
    maxTemp: Number, // Maximum cpu temperature from server.
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
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('MonitorLog', schema);
