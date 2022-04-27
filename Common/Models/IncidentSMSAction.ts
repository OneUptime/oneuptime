import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    incidentId: { type: string, ref: 'Incident', index!: true }; //Which project this incident belongs to.
 
 @Column()
    user!: User; // Which User will perfom this action.
 
 @Column()
    number!: string;
 
 @Column()
    name!: string;

 
 @Column()
    resolved!: boolean;
 
 @Column()
    acknowledged!: boolean;
 
 @Column()
    createdAt!: {
 
 @Column()
        type!: Date;
 
 @Column()
        default!: Date.now;
 
 @Column()
        expires!: 86400;
    };

    



 
 @Column()
    deletedByUser!: User;
}








