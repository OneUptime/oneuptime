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
    public monitor?: Monitor;

    @Column()
    public probe?: Probe;

    @Column()
    public status?: string = undefined;

    @Column()
    public responseTime?: number;

    @Column()
    public responseStatus?: number;

    @Column()
    public responseBody?: string = undefined;

    @Column()
    public responseHeader?: Object;

    @Column()
    public cpuLoad?: number;

    @Column()
    public avgCpuLoad?: number;

    @Column()
    public cpuCores?: number;

    @Column()
    public memoryUsed?: number;

    @Column()
    public totalMemory?: number;
    @Column()
    public swapUsed?: number;
    @Column()
    public storageUsed?: number;
    @Column()
    public totalStorage?: number;

    @Column()
    public storageUsage?: number;
    @Column()
    public mainTemp?: number;

    @Column()
    public maxTemp?: number;

    @Column()
    public incident?: Incident;

    @Column()
    public sslCertificate?: Object;

    @Column()
    public kubernetesLog?: Object;
}
