import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'Feedback',
})
export default class Feedback extends BaseModel {
    @Column()
    public project?: Project;

    @Column()
    public createdByUser?: User;

    @Column()
    public message?: string = undefined;

    @Column()
    public pageUrl?: string = undefined;

    @Column()
    public deletedByUser?: User;
}
