import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    project!: Project;
 

 
 @Column()
    createdBy!: User;
 
 @Column()
    message!: string;
 
 @Column()
    read!: [User];
 
 @Column()
    closed!: [User];
 
 @Column()
    icon!: string
 
 @Column()
    meta!: {
 
 @Column()
        type!: Object;
    };

 
 @Column()
    deletedByUser!: User;
}









