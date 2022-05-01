import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Project from './Project';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    
    @Column()
    public name!: string;

    @Column()
    public project!: Project;

    @Column()
    public isDefault!: boolean;

    @Column()
    public duration!: number;

    @Column()
    public alertTime!: string;
}
