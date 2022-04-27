import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 


 
 @Column()
    project: Project;
 
 @Column()
    schedule!: Schedule;
 
 @Column()
    activeEscalation!: {
 
 @Column()
        type!: Schema.Types.ObjectId;
 
 @Column()
        ref!: 'Escalation';
 
 @Column()
        index!: true;
    };

 
 @Column()
    escalations!: [
        {
 
 @Column()
            escalation!: {
 
 @Column()
                type!: Schema.Types.ObjectId;
 
 @Column()
                ref!: 'Escalation';
 
 @Column()
                index!: true;
            };
 
 @Column()
            callRemindersSent: number;
 
 @Column()
            smsRemindersSent: number;
 
 @Column()
            emailRemindersSent: number;
 
 @Column()
            pushRemindersSent: number;
        };
    ];

 
 @Column()
    incident: Incident
 
 @Column()
    incidentAcknowledged!: boolean; //Incident attached to this schedule is acknowledged.
    
 

 
 @Column()
    deletedByUser!: User;
 
 @Column()
    isOnDuty!: boolean;

 
 @Column()
    alertedEveryone!: boolean; //This happens when everyone in the scheudle has been alerted and they still ignore the incident.
}








