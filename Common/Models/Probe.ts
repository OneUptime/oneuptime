import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
import ObjectID from '../Types/ObjectID';
import Version from '../Types/Version';

@Entity({
    name: 'Probe',
})
export default class Probe extends BaseModel {

    @Column({
        type: 'text',
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer()
    })
    public key!: ObjectID;

    @Column({ nullable: false })
    public name!: string;

    @Column({ nullable: false })
    public slug!: string;

    @Column({ nullable: false })
    public probeVersion!: Version;

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
