import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import Component from './Component';
import ResourceLabel from './ResourceLabel';
import GitCredential from './GitCredential';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public name?: string = undefined;

    @Column()
    public slug?: string = undefined;

    @Column()
    public gitRepositoryurl?: string = undefined;

    @Column()
    public gitCredential?: GitCredential;

    @Column()
    public component?: Component;

    @Column()
    public resourceLabel?: ResourceLabel;

    @Column()
    public lastScan?: Date = undefined;

    @Column()
    public scanned?: boolean = undefined;

    @Column()
    public scanning?: boolean = undefined;
}
