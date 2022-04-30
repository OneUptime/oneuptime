import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Escalation from './Escalation';
import OnCallDutyScheduleStatus from './OnCallDutyScheduleStatus';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public escalation!: Escalation;

    @Column()
    public callRemindersSent!: number;

    @Column()
    public smsRemindersSent!: number;

    @Column()
    public emailRemindersSent!: number;

    @Column()
    public pushRemindersSent!: number;

    public onCallDutyScheduleStatus!: OnCallDutyScheduleStatus;
}
