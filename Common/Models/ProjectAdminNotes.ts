import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Project from './Project';
import User from './User';

@Entity({
    name: 'ProjectAdminNote',
})
export default class ProjectAdminNote extends BaseModel {
    @Column({ nullable: false })
    public project!: Project;

    @Column({ type: 'varchar', nullable: false })
    public note!: string;

    @Column({ nullable: false })
    public createdByUser!: User;
}
