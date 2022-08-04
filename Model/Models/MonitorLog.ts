import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

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
    public responseTime?: Number;

    @Column()
    public responseStatus?: Number;

    @Column()
    public responseBody?: string = undefined;

    @Column()
    public responseHeader?: Object;

    @Column()
    public cpuLoad?: Number;

    @Column()
    public avgCpuLoad?: Number;

    @Column()
    public cpuCores?: Number;

    @Column()
    public memoryUsed?: Number;

    @Column()
    public totalMemory?: Number;
    @Column()
    public swapUsed?: Number;
    @Column()
    public storageUsed?: Number;
    @Column()
    public totalStorage?: Number;

    @Column()
    public storageUsage?: Number;
    @Column()
    public mainTemp?: Number;

    @Column()
    public maxTemp?: Number;

    @Column()
    public incident?: Incident;

    @Column()
    public sslCertificate?: Object;

    @Column()
    public kubernetesLog?: Object;
}
