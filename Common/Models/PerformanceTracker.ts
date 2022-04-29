import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Component from './Component';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    component!: Component;

    @Column()
    name!: string;

    @Column()
    slug!: string;

    @Column()
    key!: string;

    @Column()
    showQuickStart!: boolean;

    @Column()
    createdByUser!: User;

    @Column()
    deletedByUser!: User;
}
