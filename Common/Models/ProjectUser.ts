import { Column, Entity } from 'typeorm';
import Role from '../Types/Role';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Project from './Project';
import User from './User';

@Entity({
    name: 'ProjectAdminNote',
})
export default class ProjectAdminNote extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column({ nullable: false })
    public project!: Project;

    @Column({ type: 'text', nullable: false })
    public user!: User;

    @Column({ nullable: false })
    public role!: Role;
}
