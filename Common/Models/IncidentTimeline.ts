import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    incident: { type: string, ref: 'Incident', index!: true };
 
 @Column()
    createdByUser!: User; // user
 
 @Column()
    probe: { type: string, ref: 'Probe', index!: true }; // Probe

 
 @Column()
    createdByZapier!: boolean; // Is true when zapier creates incident

 
 @Column()
    createdByApi!: boolean;

    ;

 
 @Column()
    status!: string;
 
 @Column()
    incident_state!: string;

    
 

 
 @Column()
    deletedByUser!:User;
}









