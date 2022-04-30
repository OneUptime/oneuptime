import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Incident from './Incident';
import Probe from './Probe';
import User from './User';

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
    public incident!: Incident;

    @Column()
    public createdByUser!: User; // user

    @Column()
    public probe!: Probe;

    @Column()
    public createdByZapier!: boolean; // Is true when zapier creates incident

    @Column()
    public createdByApi!: boolean;

    @Column()
    public status!: string;

    @Column()
    public incidentState!: string;

    @Column()
    public deletedByUser!: User;
}
