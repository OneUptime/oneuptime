import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    projectId: { type: String, ref: 'Project', index: true }, // Which monitor does this belong to.
    monitorId: { type: String, ref: 'Monitor', index: true }, // Which monitor does this belong to.
    probeId: { type: String, ref: 'Probe', index: true }, // Which probe does this belong to.
    status: String, // Current status based on criteria.
    responseTime: Number, // Current time taken for ping.
    responseStatus: Number, // Current status code of ping.
    cpuLoad: Number, // Current cpu load.
    avgCpuLoad: Number, // Current average cpu load from server.
    cpuCores: Number, // Current number of cpu cores.
    memoryUsed: Number, // Current memory used.
    totalMemory: Number, // Current memory size.
    swapUsed: Number, // Current swap memory used.
    storageUsed: Number, // Current disk used.
    totalStorage: Number, // Current disk size.
    storageUsage: Number, // Current disk usage.
    mainTemp: Number, // Current cpu temperature.
    maxTemp: Number, // Current maximum cpu temperature from server.
    createdAt: {
        type: Date,
        default: Date.now,
    },
    intervalDate: { type: String, index: true }, // Date of aggregate data (day)
    maxResponseTime: Number,
    maxCpuLoad: Number,
    maxMemoryUsed: Number,
    maxStorageUsed: Number,
    maxMainTemp: Number,
    sslCertificate: Object,
    kubernetesLog: Object,
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('MonitorLogByDay', schema);
