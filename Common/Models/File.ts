import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Project from './Project';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public name?: Project;

    @Column()
    public fileExtention?: string = undefined;

    @Column()
    public base64Content?: string = undefined;
}
