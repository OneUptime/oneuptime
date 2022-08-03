import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public user?: User;

    @Column()
    public sentTo?: string = undefined;

    @Column()
    public project?: Project;

    @Column()
    public content?: string = undefined;

    @Column()
    public deletedByUser?: User;

    @Column()
    public status?: string = undefined;

    @Column()
    public error?: string = undefined;
}
