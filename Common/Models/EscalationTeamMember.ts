import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import Team from './Team';
import User from './User';

@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel {

    @Column()
    startTime!: Date;

    @Column()
    endTime!: Date;

    @Column()
    timezone!: string;

    @Column()
    user!: User;

    @Column()
    team!: Team

}
