import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'IncidentPriority',
})
export default class IncidentPriority extends BaseModel {
    @Column()
    public project?: Project;

    @Column()
    public name?: string = undefined;

    @Column()
    public color?: string = undefined;

    @Column()
    public deletedByUser?: User;
}
