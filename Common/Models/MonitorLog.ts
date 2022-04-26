import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    monitorId: { type: string, ref: 'Monitor', index: true }, // Which monitor does this belong to.
    probeId: { type: string, ref: 'Probe', index: true }, // Which probe does this belong to.
    status: string, // Status based on criteria.
    responseTime: Number, // Time taken for ping.
    responseStatus: Number, // Status code of ping.
    responseBody: string, //Response body of ping
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
    incidentIds: [{ type: string, ref: 'Incident', index: true }],
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
        error: string,
        statusText: string,
    },
}









