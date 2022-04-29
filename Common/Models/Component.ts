import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
    name: 'UserAlerts',
})
export default class ComponentModel extends BaseModel {
    @Column()
    project!: Project;

    @Column()
    name!: string;

    @Column()
    slug!: string;

    @Column()
    createdByUser!: User;

    @Column()
    deletedByUser!: User;
}
