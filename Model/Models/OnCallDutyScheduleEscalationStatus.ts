import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Escalation from './Escalation';
import OnCallDutyScheduleStatus from './OnCallDutyScheduleStatus';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public escalation?: Escalation;

    @Column()
    public callRemindersSent?: number;

    @Column()
    public smsRemindersSent?: number;

    @Column()
    public emailRemindersSent?: number;

    @Column()
    public pushRemindersSent?: number;

    public onCallDutyScheduleStatus?: OnCallDutyScheduleStatus;
}
