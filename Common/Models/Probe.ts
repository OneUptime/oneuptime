import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

// import User from './User';
// import Project from './Project';
import ObjectID from '../Types/ObjectID';
import Version from '../Types/Version';
import RequiredColumn from '../Types/Database/RequiredColumnDecorator';
import UniqueColumn from '../Types/Database/UniqueColumnDecorator';

@Entity({
    name: 'Probe',
})
export default class Probe extends BaseModel {

    @RequiredColumn()
    @UniqueColumn()
    @Column({
        type: 'text',
        nullable: false,
        unique: true, 
        // transformer: ObjectID.getDatabaseTransformer()
    })
    public key!: ObjectID;

    @RequiredColumn()
    @Column({ nullable: false })
    public name!: string;

    @RequiredColumn()
    @UniqueColumn()
    @Column({ nullable: false })
    public slug!: string;

    @RequiredColumn()
    @Column({ nullable: false })
    public probeVersion!: Version;

    @RequiredColumn()
    @Column({ nullable: false, default: Date.now() })
    public lastAlive!: Date;

    @Column({ nullable: true })
    public icon?: string;

    // // If this probe is custom to the project and only monitoring reosurces in this project.
    // @Column({ nullable: true })
    // public project?: Project;

    // @Column({ nullable: true })
    // public deletedByUser?: User;
}
