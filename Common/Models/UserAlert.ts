import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
import Incident, { IncidentState } from './Incident';
import Escalation from './Escalation';
import OnCallDutySchedule from './OnCallDutySchedule';

@Entity({
    name: 'UserAlerts',
})
export default class UserAlerts extends BaseModel {
    @Column({
        nullable: false,
    })
    public project?: Project;

    @Column({
        nullable: false,
    })
    public user?: User;

    @Column()
    public alertType? : string = undefined;

    @Column()
    public alertStatus? : string = undefined;

    @Column()
    public eventType?: IncidentState;

    @Column()
    public incident?: Incident;

    @Column()
    public onCallScheduleStatus?: OnCallDutySchedule;

    @Column()
    public onCallDutySchedule?: OnCallDutySchedule;

    @Column()
    public escalation?: Escalation;

    @Column()
    public error?: boolean = undefined;

    @Column()
    public errorMessage? : string = undefined;

    @Column()
    public alertProgress? : string = undefined;

    @Column()
    public deletedByUser?: User;
}
