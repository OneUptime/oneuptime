import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';

@Entity({
    name: 'TeamMember',
})
export default class TeamMember extends BaseModel {
    @Column()
    @Index()
    team!: Team;

    @Column()
    user!: User;

    @Column()
    createdByUser!: User;

    @Column()
    deletedByUser!: User;
}
