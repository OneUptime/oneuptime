import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import Monitor from './Monitor';
import Probe from './Probe';
import Incident from './Incident';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    monitor!: Monitor;

    @Column()
    probe!: Probe;

    @Column()
    status!: string;

    @Column()
    responseTime!: Number;

    @Column()
    responseStatus!: Number;

    @Column()
    responseBody!: string;

    @Column()
    responseHeader!: Object;

    @Column()
    cpuLoad!: Number;

    @Column()
    avgCpuLoad!: Number;

    @Column()
    cpuCores!: Number;

    @Column()
    memoryUsed!: Number;

    @Column()
    totalMemory!: Number;
    @Column()
    swapUsed!: Number;
    @Column()
    storageUsed!: Number;
    @Column()
    totalStorage!: Number;

    @Column()
    storageUsage!: Number;
    @Column()
    mainTemp!: Number;

    @Column()
    maxTemp!: Number;

    @Column()
    incident!: Incident;

    @Column()
    sslCertificate!: Object;

    @Column()
    kubernetesLog!: Object;
}
