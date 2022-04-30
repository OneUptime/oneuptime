import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';
import OnCallDutySchedule from './OnCallDutySchedule';

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
    public project!: Project;

    @Column()
    public callReminders!: number;

    @Column()
    public emailReminders!: number;

    @Column()
    public smsReminders!: number;

    @Column()
    public pushReminders!: number;

    @Column()
    public rotateBy!: string;

    @Column()
    public rotationInterval!: number;

    @Column()
    public firstRotationOn!: Date;

    @Column()
    public rotationTimezone!: string;

    @Column()
    public call!: boolean;

    @Column()
    public email!: boolean;

    @Column()
    public sms!: boolean;

    @Column()
    public push!: boolean;

    @Column()
    public createdByUser!: User;

    @Column()
    public onCallDutySchedule!: OnCallDutySchedule;

    @Column()
    public deletedByUser!: User;
}
