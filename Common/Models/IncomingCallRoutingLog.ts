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
    public project?: Project;

    @Column()
    public callRouting?: IncomingCallRouting;

    @Column()
    public deletedByUser?: User;

    @Column()
    public callSid? : string = undefined;

    @Column()
    public price? : string = undefined;

    @Column()
    public calledFrom? : string = undefined;

    @Column()
    public calledTo? : string = undefined;

    @Column()
    public duration? : string = undefined;

    @Column()
    public user?: User; // User that call was forwarded to

    @Column()
    public schedule?: OnCallDutySchedule;

    @Column()
    public phoneNumber? : string = undefined; // Phone number that call was forwarded to

    @Column()
    public status?: OperationStatus;
}
