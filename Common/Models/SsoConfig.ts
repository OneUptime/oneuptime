import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
    name: 'SsoConfig',
})
export default class SsoConfig extends BaseModel {
    @Column({ nullable: false })
    public enabled!: boolean;

    @Index()
    @Column({ nullable: false })
    public domain!: string;

    @Column({ nullable: false })
    public entity!: string;

    @Column({ nullable: false })
    public loginUrl!: string;

    @Column()
    public certificateFingerprint!: string;

    @Column({ nullable: false })
    public logoutUrl!: string;

    @Column()
    public ipRanges!: string;

    @Column({ nullable: false })
    public deletedByUser!: User;

    @Index()
    @Column({ nullable: false })
    public project!: Project;
}
