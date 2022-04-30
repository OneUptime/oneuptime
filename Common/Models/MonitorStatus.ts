import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import ResourceStatus from './ResourceStatus';
import Incident from './Incident';
import Probe from './Probe';
import Monitor from './Monitor';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public monitor!: Monitor;

    @Column()
    public probe!: Probe;

    @Column()
    public incident!: Incident;

    @Column()
    public status!: ResourceStatus;

    @Column()
    public manuallyCreated!: boolean;

    @Column()
    public startTime!: Date;

    @Column()
    public endTime!: Date;

    @Column()
    public lastStatus!: string;

    @Column()
    public deletedByUser!: User;
}
