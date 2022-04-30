import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import ApplicationSecurityRunInstance from './ApplicationSecurityRunInstance';
import SecuritySeverity from '../Types/SecuritySeverity';

@Entity({
    name: 'ApplicationSecurityRunInstanceLog',
})
export default class ApplicationSecurityRunInstanceLog extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public applicationSeurityRunInstance!: ApplicationSecurityRunInstance;

    @Column()
    public severity!: SecuritySeverity;

    @Column()
    public log!: string;
}
