import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';


@Entity({
       name: "GitCredential"
})
export default class GitCredential extends BaseModel {

       @Column()
       gitUsername!: string;

       @Column()
       gitPassword!: string;

       @Column()
       sshTitle!: string;

       @Column()
       sshPrivateKey!: string;

       @Column()
       iv!: Buffer;

       @Index()
       @Column()
       project!: Project

       @Column()
       createdByUser!: User

       @Column()
       deletedByUser!: User
};







