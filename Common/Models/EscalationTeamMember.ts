import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Team from './Team';
import User from './User';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public startTime!: Date;

    @Column()
    public endTime!: Date;

    @Column()
    public timezone!: string;

    @Column()
    public user!: User;

    @Column()
    public team!: Team;
}
