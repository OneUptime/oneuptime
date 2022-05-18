import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'UserAlerts',
})
export default class ComponentModel extends BaseModel {
    @Column()
    public project?: Project;

    @Column()
    public name? : string = undefined;

    @Column()
    public slug? : string = undefined;

    @Column()
    public createdByUser?: User;

    @Column()
    public deletedByUser?: User;
}
