import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'SsoConfig',
})
export default class SsoConfig extends BaseModel {
    @Column({ nullable: false })
    public enabled?: boolean = undefined;

    @Index()
    @Column({ nullable: false })
    public domain?: string = undefined;

    @Column({ nullable: false })
    public entity?: string = undefined;

    @Column({ nullable: false })
    public loginUrl?: string = undefined;

    @Column()
    public certificateFingerprint?: string = undefined;

    @Column({ nullable: false })
    public logoutUrl?: string = undefined;

    @Column()
    public ipRanges?: string = undefined;

    @Column({ nullable: false })
    public deletedByUser?: User;

    @Index()
    @Column({ nullable: false })
    public project?: Project;
}
