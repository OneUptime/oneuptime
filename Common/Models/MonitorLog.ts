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
    status!: string; // Status based on criteria.
 
 @Column()
    responseTime!: Number; // Time taken for ping.
 
 @Column()
    responseStatus!: Number; // Status code of ping.
 
 @Column()
    responseBody!: string; //Response body of ping
 
 @Column()
    responseHeader!: Object; //Response header(s) of ping
 
 @Column()
    cpuLoad!: Number; // Cpu load.
 
 @Column()
    avgCpuLoad!: Number; // Average cpu load from server.
 
 @Column()
    cpuCores!: Number; // Number of cpu cores.
 
 @Column()
    memoryUsed!: Number; // Memory used.
 
 @Column()
    totalMemory!: Number; // Memory size.
 
 @Column()
    swapUsed!: Number; // Swap memory used.
 
 @Column()
    storageUsed!: Number; // Disk used.
 
 @Column()
    totalStorage!: Number; // Disk size.
 
 @Column()
    storageUsage!: Number; // Disk usage.
 
 @Column()
    mainTemp!: Number; // Cpu temperature.
 
 @Column()
    maxTemp!: Number; // Maximum cpu temperature from server.
 
 @Column()
    incidentIds: [{ type: string, ref: 'Incident', index!: true }];
 
 @Column()
    createdAt!: {
 
 @Column()
        type!: Date;
 
 @Column()
        default!: Date.now;
 
 @Column()
        index!: true;
    };
 
 @Column()
    sslCertificate!: Object;
 
 @Column()
    kubernetesLog!: Object;
 
 @Column()
    scriptMetadata!: {
 
 @Column()
        executionTime!: Number;
 
 @Column()
        consoleLogs!: [String];
 
 @Column()
        error!: string;
 
 @Column()
        statusText!: string;
    };
}









