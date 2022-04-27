import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    issueId: { type: string, ref: 'Issue', index!: true };
 
 @Column()
    createdByUser!: User;

    ;

 
 @Column()
    status!: {
 
 @Column()
        type!: string;
 
 @Column()
        enum!: ['ignore', 'unresolve', 'resolve', 'unignore'];
 
 @Column()
        required!: true;
    };

    
 

 
 @Column()
    deletedByUser: { type: string, ref!: 'User' };
}









