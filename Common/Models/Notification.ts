import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import Project from './Project';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    project!: Project;

    @Column()
    message!: string;

    @Column()
    icon!: string;
}
