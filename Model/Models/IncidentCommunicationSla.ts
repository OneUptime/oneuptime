import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Project from './Project';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public name?: string = undefined;

    @Column()
    public project?: Project;

    @Column()
    public isDefault?: boolean = undefined;

    @Column()
    public duration?: number;

    @Column()
    public alertTime?: string = undefined;
}
