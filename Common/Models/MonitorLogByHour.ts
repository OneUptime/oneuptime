import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    monitorId!: Monitor; // Which monitor does this belong to.
 
 @Column()
    probeId: { type: string, ref: 'Probe', index!: true }; // Which probe does this belong to.
 
 @Column()
    status!: string; // Current status based on criteria.
 
 @Column()
    responseTime!: Number; // Current time taken for ping.
 
 @Column()
    responseStatus!: Number; // Current status code of ping.
 
 @Column()
    cpuLoad!: Number; // Current cpu load.
 
 @Column()
    avgCpuLoad!: Number; // Current average cpu load from server.
 
 @Column()
    cpuCores!: Number; // Current number of cpu cores.
 
 @Column()
    memoryUsed!: Number; // Current memory used.
 
 @Column()
    totalMemory!: Number; // Current memory size.
 
 @Column()
    swapUsed!: Number; // Current swap memory used.
 
 @Column()
    storageUsed!: Number; // Current disk used.
 
 @Column()
    totalStorage!: Number; // Current disk size.
 
 @Column()
    storageUsage!: Number; // Current disk usage.
 
 @Column()
    mainTemp!: Number; // Current cpu temperature.
 
 @Column()
    maxTemp!: Number; // Current maximum cpu temperature from server.
    ;
 
 @Column()
    intervalDate!: string; // Date of aggregate data (hour)
 
 @Column()
    maxResponseTime!: Number;
 
 @Column()
    maxCpuLoad!: Number;
 
 @Column()
    maxMemoryUsed!: Number;
 
 @Column()
    maxStorageUsed!: Number;
 
 @Column()
    maxMainTemp!: Number;
 
 @Column()
    sslCertificate!: Object;
 
 @Column()
    kubernetesLog!: Object;
}









