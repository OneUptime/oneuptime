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
    project!: Project;

    @Column()
    name!: string;

    @Column()
    createdByUser!: User;

    @Column()
    deletedByUser!: User;
}
