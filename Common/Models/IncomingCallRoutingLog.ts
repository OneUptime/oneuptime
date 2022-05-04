import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
import IncomingCallRouting from './IncomingCallRouting';
import OnCallDutySchedule from './OnCallDutySchedule';
import OperationStatus from '../Types/Operation/OperationStatus';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public project!: Project;

    @Column()
    public callRouting!: IncomingCallRouting;

    @Column()
    public deletedByUser!: User;

    @Column()
    public callSid!: string;

    @Column()
    public price!: string;

    @Column()
    public calledFrom!: string;

    @Column()
    public calledTo!: string;

    @Column()
    public duration!: string;

    @Column()
    public user!: User; // User that call was forwarded to

    @Column()
    public schedule!: OnCallDutySchedule;

    @Column()
    public phoneNumber!: string; // Phone number that call was forwarded to

    @Column()
    public status!: OperationStatus;
}
