import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Incident from './Incident';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public incident!: Incident;

    @Column()
    public user!: User; // Which User will perfom this action.

    @Column()
    public number!: string;

    @Column()
    public name!: string;

    @Column()
    public resolved!: boolean;

    @Column()
    public acknowledged!: boolean;

    @Column()
    public deletedByUser!: User;
}
