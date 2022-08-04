import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Project from './Project';
import OnCallDutySchedule from './OnCallDutySchedule';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public project?: Project;

    @Column()
    public callReminders?: number;

    @Column()
    public emailReminders?: number;

    @Column()
    public smsReminders?: number;

    @Column()
    public pushReminders?: number;

    @Column()
    public rotateBy?: string = undefined;

    @Column()
    public rotationInterval?: number;

    @Column()
    public firstRotationOn?: Date = undefined;

    @Column()
    public rotationTimezone?: string = undefined;

    @Column()
    public call?: boolean = undefined;

    @Column()
    public email?: boolean = undefined;

    @Column()
    public sms?: boolean = undefined;

    @Column()
    public push?: boolean = undefined;

    @Column()
    public createdByUser?: User;

    @Column()
    public onCallDutySchedule?: OnCallDutySchedule;

    @Column()
    public deletedByUser?: User;
}
