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
    public project?: Project;

    @Index()
    @Column()
    public component?: Component;

    @Column()
    public name? : string = undefined;

    @Column()
    public slug? : string = undefined;

    @Column()
    public key? : string = undefined;

    @Column()
    public resourceLabel?: ResourceLabel;

    @Column()
    public showQuickStart?: boolean = undefined;

    @Column()
    public createdByUser?: User;

    @Column()
    public deletedByUser?: User;
}
