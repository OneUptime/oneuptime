import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Incident from './Incident';
import Probe from './Probe';
import User from './User';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public incident!: Incident;

    @Column()
    public createdByUser!: User; // user

    @Column()
    public probe!: Probe;

    @Column()
    public createdByZapier!: boolean; // Is true when zapier creates incident

    @Column()
    public createdByApi!: boolean;

    @Column()
    public status!: string;

    @Column()
    public incidentState!: string;

    @Column()
    public deletedByUser!: User;
}
