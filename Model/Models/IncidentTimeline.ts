import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import Incident from './Incident';
import Probe from './Probe';
import User from './User';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public incident?: Incident;

    @Column()
    public createdByUser?: User; // user

    @Column()
    public probe?: Probe;

    @Column()
    public createdByZapier?: boolean = undefined; // Is true when zapier creates incident

    @Column()
    public createdByApi?: boolean = undefined;

    @Column()
    public status?: string = undefined;

    @Column()
    public incidentState?: string = undefined;

    @Column()
    public deletedByUser?: User;
}
