import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import ResourceStatus from './ResourceStatus';
import Incident from './Incident';
import Probe from './Probe';
import Monitor from './Monitor';
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
    public monitor!: Monitor;

    @Column()
    public probe!: Probe;

    @Column()
    public incident!: Incident;

    @Column()
    public status!: ResourceStatus;

    @Column()
    public manuallyCreated!: boolean;

    @Column()
    public startTime!: Date;

    @Column()
    public endTime!: Date;

    @Column()
    public lastStatus!: string;

    @Column()
    public deletedByUser!: User;
}
