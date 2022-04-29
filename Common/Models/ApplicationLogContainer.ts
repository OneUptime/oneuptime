import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import ResourceLabel from './ResourceLabel';
import Component from './Component';

@Entity({
    name: 'ApplicationLogContainer',
})
export default class ApplicationLogContainer extends BaseModel {
    @Index()
    @Column()
    project!: Project;

    @Index()
    @Column()
    component!: Component;

    @Column()
    name!: string;

    @Column()
    slug!: string;

    @Column()
    key!: string;

    @Column()
    resourceLabel!: ResourceLabel;

    @Column()
    showQuickStart!: boolean;

    @Column()
    createdByUser!: User;

    @Column()
    deletedByUser!: User;
}
