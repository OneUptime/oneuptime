import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';


@Entity({
       name: "DockerCredential"
})
export default class DockerCredential extends BaseModel {

       @Column()
       dockerRegistryUrl!: URL;

       @Column()
       dockerUsername!: string;

       @Column()
       dockerPassword!: string;

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



