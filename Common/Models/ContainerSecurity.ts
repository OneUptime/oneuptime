import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import DockerCredential from './DockerCredential';
import Component from './Component';
import ResourceLabel from './ResourceLabel';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public name? : string = undefined;

    @Column()
    public slug? : string = undefined;

    @Column()
    public dockerCredential?: DockerCredential;

    @Column()
    public imagePath? : string = undefined;

    @Column()
    public imageTags? : string = undefined;

    @Column()
    public component?: Component;

    @Column()
    public resourceLabel?: ResourceLabel;

    @Column()
    public deleteAt?: Date = undefined;

    @Column()
    public lastScan?: Date = undefined;

    @Column()
    public scanned?: boolean = undefined;

    @Column()
    public scanning?: boolean = undefined;
}
