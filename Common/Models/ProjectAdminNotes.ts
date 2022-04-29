import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import Project from './Project';
import User from './User';

@Entity({
    name: 'ProjectAdminNote',
})
export default class ProjectAdminNote extends BaseModel {
    @Column({ nullable: false })
    project!: Project;

    @Column({ type: 'text', nullable: false })
    note!: string;

    @Column({ nullable: false })
    createdByUser!: User;
}
