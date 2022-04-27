import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
       name: "ResourceLabel"
})
export default class ResourceLabel extends BaseModel {

       @Column()
       @Index()
       project!: Project

       @Column()
       name!: string;

       @Column()
       createdByUser!: User

       @Column()
       deletedByUser!: User;
}








