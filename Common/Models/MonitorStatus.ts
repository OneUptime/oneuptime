import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    monitorId!: Monitor; //Which monitor does this belong to.
 
 @Column()
    probeId: { type: string, ref: 'Probe', index!: true }; //Which probe does this belong to.
 
 @Column()
    incidentId: { type: string, ref: 'Incident', index!: true };
 
 @Column()
    status!: string;
 
 @Column()
    manuallyCreated!: boolean;
 
 @Column()
    startTime!: {
 
 @Column()
        type!: Date;
 
 @Column()
        default!: Date.now;
    };
 
 @Column()
    endTime!: Date;
 
 @Column()
    lastStatus!: string;
    
 

 
 @Column()
    deletedByUser!: User;
}









