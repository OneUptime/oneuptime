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
    public project!: Project;

    @Index()
    @Column()
    public component!: Component;

    @Column()
    public name!: string;

    @Column()
    public slug!: string;

    @Column()
    public key!: string;

    @Column()
    public resourceLabel!: ResourceLabel;

    @Column()
    public showQuickStart!: boolean;

    @Column()
    public createdByUser!: User;

    @Column()
    public deletedByUser!: User;
}
