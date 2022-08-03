import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import Team from './Team';
import User from './User';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public startTime?: Date = undefined;

    @Column()
    public endTime?: Date = undefined;

    @Column()
    public timezone?: string = undefined;

    @Column()
    public user?: User;

    @Column()
    public team?: Team;
}
