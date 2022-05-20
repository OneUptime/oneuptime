import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
import Incident from './Incident';
import OnCallDutySchedule from './OnCallDutySchedule';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public project?: Project;

    @Column()
    public onCallDutySchedule?: OnCallDutySchedule;

    @Column()
    public incident?: Incident;

    @Column()
    public incidentAcknowledged?: boolean = undefined;

    @Column()
    public deletedByUser?: User;

    @Column()
    public isOnDuty?: boolean = undefined;

    @Column()
    public alertedEveryone?: boolean = undefined;
}
