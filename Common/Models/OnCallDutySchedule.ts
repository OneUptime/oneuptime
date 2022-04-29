import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';


@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    name!: string;
 
 @Column()
    slug!: string;
 
 @Column()
    project!: Project;
 
 @Column()
    createdByUser!: User;
 
 @Column()
    deletedByUser!: User;
}





