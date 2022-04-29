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
    name!: string;

    @Column()
    slug!: string;

    @Column()
    gitRepositoryurl!: string;

    @Column()
    gitCredential!: GitCredential;

    @Column()
    component!: Component;

    @Column()
    resourceLabel!: ResourceLabel;

    @Column()
    lastScan!: Date;

    @Column()
    scanned!: boolean;

    @Column()
    scanning!: boolean;
}
