import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
    name: 'Team',
})
export default class Team extends BaseModel {
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
