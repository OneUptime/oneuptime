import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Issue from './Issue';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public issue?: Issue;

    @Column()
    public user?: User;

    @Column()
    public createdByUser?: User;

    @Column()
    public removed?: boolean = undefined;

    @Column()
    public removedAt?: Date = undefined;

    @Column()
    public removedBy?: User;
}
