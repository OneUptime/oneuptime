import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    project!: {
 
 @Column()
        type!: string;
 
 @Column()
        ref!: 'Project';
 
 @Column()
        alias!: 'project';
 
 @Column()
        index!: true;
    };
 
 @Column()
    name!: string;
 
 @Column()
    teams: [{ type: string, ref: 'User', default!: null }];
 
 @Column()
    createdByUser!: User
    ;
    

 
   @Column()
   deletedByUser!: User;
}








