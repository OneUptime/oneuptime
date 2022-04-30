import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Issue from './Issue';

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
    public issue!: Issue;

    @Column()
    public user!: User;

    @Column()
    public createdByUser!: User;

    @Column()
    public removed!: boolean;

    @Column()
    public removedAt!: Date;

    @Column()
    public removedBy!: User;
}
