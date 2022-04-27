import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    incidentId: { type: string, ref: 'Incident', index!: true };
 
 @Column()
    createdByUser!: User; // user
 
 @Column()
    probeId: { type: string, ref: 'Probe', index!: true }; // ProbeId

 
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
    deletedByUser: { type: string, ref!: 'User' };
}









