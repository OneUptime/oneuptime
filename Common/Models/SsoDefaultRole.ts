import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';
import Role from '../Types/Role';

@Entity({
    name: 'SsoDefaultRole',
})
export default class SsoDefaultRole extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public domain!: string;

    @Column()
    public project!: Project;

    @Column()
    public role!: Role;

    @Column()
    public deletedByUser!: User;
}
