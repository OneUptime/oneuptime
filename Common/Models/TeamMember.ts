import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';

import Team from './Team';
import User from './User';

@Entity({
    name: 'TeamMember',
})
export default class TeamMember extends BaseModel {
    @Column()
    @Index()
    public team!: Team;

    @Column()
    public user!: User;

    @Column()
    public createdByUser!: User;

    @Column()
    public deletedByUser!: User;
}
