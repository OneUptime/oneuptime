import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
import IncidentPriority from './IncidentPriority';

@Entity({
    name: 'IncidentSetting',
})
export default class IncidentSetting extends BaseModel {
    
    @Column()
    public project!: Project;

    @Column()
    public title!: string;

    @Column()
    public description!: string;

    @Column()
    public incidentPriority!: IncidentPriority;

    @Column()
    public isDefault!: boolean;

    @Column()
    public name!: string;

    @Column()
    public deletedByUser!: User;
}
