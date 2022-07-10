import { Column, Entity } from 'typeorm';
import Role from '../Types/Permissions';
import BaseModel from './BaseModel';

import Project from './Project';
import User from './User';

@Entity({
    name: 'ProjectAdminNote',
})
export default class ProjectAdminNote extends BaseModel {
    @Column({ nullable: false })
    public project?: Project;

    @Column({ type: 'varchar', nullable: false })
    public user?: User;

    @Column({ nullable: false })
    public role?: Role;
}
