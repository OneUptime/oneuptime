import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
    name: 'IncidentPriority',
})
export default class IncidentPriority extends BaseModel {
    @Column()
    project!: Project;

    @Column()
    name!: string;

    @Column()
    color!: string;

    @Column()
    deletedByUser!: User;
}
