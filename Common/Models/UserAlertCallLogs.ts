import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';
import OperationStatus from '../Types/Operation/OperationStatus';

@Entity({
    name: 'CallLog',
})
export default class CallLog extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public fromNumber!: string;

    @Column()
    public toNumber!: string;

    @Column()
    public project!: Project;

    @Column()
    public deletedByUser!: User;

    @Column()
    public content!: string;

    @Column()
    public status!: OperationStatus;

    @Column()
    public errorDescription!: string;
}
