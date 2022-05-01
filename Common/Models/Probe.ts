import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'Probe',
})
export default class Probe extends BaseModel {
    
    @Column({ nullable: false })
    public key!: string;

    @Column({ nullable: false })
    public name!: string;

    @Column({ nullable: false })
    public slug!: string;

    @Column({ nullable: false })
    public probeVersion!: string;

    @Column({ nullable: false, default: Date.now() })
    public lastAlive!: Date;

    @Column({ nullable: true })
    public icon!: string;

    // If this probe is custom to the project and only monitoring reosurces in this project.
    @Column({ nullable: true })
    public project?: Project;

    @Column({ nullable: true })
    public deletedByUser!: User;
}
