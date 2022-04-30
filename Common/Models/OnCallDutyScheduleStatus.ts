import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';
import Incident from './Incident';
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
    public onCallDutySchedule!: OnCallDutySchedule;

    @Column()
    public incident!: Incident;

    @Column()
    public incidentAcknowledged!: boolean;

    @Column()
    public deletedByUser!: User;

    @Column()
    public isOnDuty!: boolean;

    @Column()
    public alertedEveryone!: boolean;
}
