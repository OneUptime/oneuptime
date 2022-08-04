import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

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
    public monitor?: Monitor;

    @Column()
    public probe?: Probe;

    @Column()
    public incident?: Incident;

    @Column()
    public status?: ResourceStatus;

    @Column()
    public manuallyCreated?: boolean = undefined;

    @Column()
    public startTime?: Date = undefined;

    @Column()
    public endTime?: Date = undefined;

    @Column()
    public lastStatus?: string = undefined;

    @Column()
    public deletedByUser?: User;
}
