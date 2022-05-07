import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Component from './Component';
import ResourceLabel from './ResourceLabel';
import GitCredential from './GitCredential';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public name!: string;

    @Column()
    public slug!: string;

    @Column()
    public gitRepositoryurl!: string;

    @Column()
    public gitCredential!: GitCredential;

    @Column()
    public component!: Component;

    @Column()
    public resourceLabel!: ResourceLabel;

    @Column()
    public lastScan!: Date;

    @Column()
    public scanned!: boolean;

    @Column()
    public scanning!: boolean;
}
