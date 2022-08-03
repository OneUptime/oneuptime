import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Component from './Component';
import ResourceLabel from './ResourceLabel';

@Entity({
    name: 'ErrorTrackerContainer',
})
export default class ErrorTrackerContainer extends BaseModel {
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
    public resourceLabel?: ResourceLabel;

    @Column()
    public createdByUser?: User;

    @Column()
    public deletedByUser?: User;
}
