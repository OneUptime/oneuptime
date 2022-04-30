import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import Incident from './Incident';
import OnCallDutySchedule from './OnCallDutySchedule';
import Escalation from './Escalation';
import OnCallDutyScheduleStatus from './OnCallDutyScheduleStatus';


@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel {

    @Column()
    escalation!: Escalation;

    @Column()
    callRemindersSent!: number;

    @Column()
    smsRemindersSent!: number;

    @Column()
    emailRemindersSent!: number;

    @Column()
    pushRemindersSent!: number;

    onCallDutyScheduleStatus!: OnCallDutyScheduleStatus
}
