import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'SsoDefaultRole',
})
export default class SsoDefaultRole extends BaseModel {
    @Column()
    public domain?: string = undefined;

    @Column()
    public project?: Project;


    @Column()
    public deletedByUser?: User;
}
