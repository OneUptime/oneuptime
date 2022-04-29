import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
       name: "SsoConfig"
})
export default class SsoConfig extends BaseModel {

       @Column({nullable: false})
       enabled!: boolean

       @Index()
       @Column({nullable: false})
       domain!: string

       @Column({nullable: false})
       entity!: string

       @Column({nullable: false})
       loginUrl!: string

       @Column()
       certificateFingerprint!: string;

       @Column({nullable: false})
       logoutUrl!: string

       @Column()
       ipRanges!: string;

       @Column({nullable: false})
       deletedByUser!: User

       @Index()
       @Column({nullable: false})
       project!: Project
}









