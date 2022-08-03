import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public name?: string = undefined;

    @Column()
    public slug?: string = undefined;

    @Column()
    public project?: Project;

    @Column()
    public createdByUser?: User;

    @Column()
    public deletedByUser?: User;
}
