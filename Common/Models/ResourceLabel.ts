import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'ResourceLabel',
})
export default class ResourceLabel extends BaseModel {
    @Column()
    @Index()
    public project!: Project;

    @Column()
    public name!: string;

    @Column()
    public createdByUser!: User;

    @Column()
    public deletedByUser!: User;
}
