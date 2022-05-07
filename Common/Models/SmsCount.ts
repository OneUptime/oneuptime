import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public user!: User;

    @Column()
    public sentTo!: string;

    @Column()
    public project!: Project;

    @Column()
    public content!: string;

    @Column()
    public deletedByUser!: User;

    @Column()
    public status!: string;

    @Column()
    public error!: string;
}
