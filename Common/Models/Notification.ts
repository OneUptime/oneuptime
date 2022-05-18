import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Project from './Project';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public project?: Project;

    @Column()
    public message? : string = undefined;

    @Column()
    public icon? : string = undefined;
}
