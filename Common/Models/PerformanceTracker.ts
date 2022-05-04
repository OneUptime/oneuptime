import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Component from './Component';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public component!: Component;

    @Column()
    public name!: string;

    @Column()
    public slug!: string;

    @Column()
    public key!: string;

    @Column()
    public showQuickStart!: boolean;

    @Column()
    public createdByUser!: User;

    @Column()
    public deletedByUser!: User;
}
