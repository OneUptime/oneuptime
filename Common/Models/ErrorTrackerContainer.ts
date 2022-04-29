import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Component from './Component';
import ResourceLabel from './ResourceLabel';

@Entity({
    name: 'ErrorTrackerContainer',
})
export default class ErrorTrackerContainer extends BaseModel {
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
    resourceLabel!: ResourceLabel;

    @Column()
    createdByUser!: User;

    @Column()
    deletedByUser!: User;
}
