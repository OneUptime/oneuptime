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
    monitor!: Monitor;

    @Column()
    probe!: Probe;

    @Column()
    incident!: Incident;

    @Column()
    status!: ResourceStatus;

    @Column()
    manuallyCreated!: boolean;

    @Column()
    startTime!: Date;

    @Column()
    endTime!: Date;

    @Column()
    lastStatus!: string;

    @Column()
    deletedByUser!: User;
}
