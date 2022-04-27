import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    user: { type: string, ref: 'User', alias: 'users', index!: true };
 
 @Column()
    sentTo!: string;
 

 
 @Column()
    project!: Project;
 
 @Column()
    parentproject!: Project;
 
 @Column()
    deleted: { type: Boolean, default: false, index!: true };


 
 @Column()
    deletedByUser!: User;
 
 @Column()
    content!: string;
 
 @Column()
    status!: string;
 
 @Column()
    error!: string;
}









