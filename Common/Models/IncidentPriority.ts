import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'IncidentPriority',
})
export default class IncidentPriority extends BaseModel {
    @Column()
    public project!: Project;

    @Column()
    public name!: string;

    @Column()
    public color!: string;

    @Column()
    public deletedByUser!: User;
}
