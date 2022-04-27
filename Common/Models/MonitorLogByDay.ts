import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    project: Project, // Which monitor does this belong to.
    monitorId: Monitor, // Which monitor does this belong to.
    probeId: { type: string, ref: 'Probe', index: true }, // Which probe does this belong to.
    status: string, // Current status based on criteria.
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
    ,
    intervalDate: string, // Date of aggregate data (day)
    maxResponseTime: Number,
    maxCpuLoad: Number,
    maxMemoryUsed: Number,
    maxStorageUsed: Number,
    maxMainTemp: Number,
    sslCertificate: Object,
    kubernetesLog: Object,
}









