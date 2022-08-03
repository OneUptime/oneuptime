import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Incident from './Incident';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public incident?: Incident;

    @Column()
    public user?: User; // Which User will perfom this action.

    @Column()
    public number?: string = undefined;

    @Column()
    public name?: string = undefined;

    @Column()
    public resolved?: boolean = undefined;

    @Column()
    public acknowledged?: boolean = undefined;

    @Column()
    public deletedByUser?: User;
}
