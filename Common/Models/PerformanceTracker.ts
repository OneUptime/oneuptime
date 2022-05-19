import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Component from './Component';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public component?: Component;

    @Column()
    public name?: string = undefined;

    @Column()
    public slug?: string = undefined;

    @Column()
    public key?: string = undefined;

    @Column()
    public showQuickStart?: boolean = undefined;

    @Column()
    public createdByUser?: User;

    @Column()
    public deletedByUser?: User;
}
