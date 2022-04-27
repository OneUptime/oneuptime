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
    callRoutingId: { type: string, ref: 'CallRouting', index!: true };
    



 
 @Column()
    deletedByUser!: User;
 
 @Column()
    callSid!: string;
 
 @Column()
    price!: string;
 
 @Column()
    calledFrom!: string;
 
 @Column()
    calledTo!: string;
 
 @Column()
    duration!: string;
 
 @Column()
    dialTo!: [
        {
 
 @Column()
            callSid!: string;
 
 @Column()
            user!: User; // User that call was forwarded to
 
 @Column()
            scheduleId: { type: string, ref: 'Schedule', index!: true }; // ScheduleId || ''
 
 @Column()
            phoneNumber!: string; // Phone number that call was forwarded to
 
 @Column()
            status!: string; // Completed/in progress/...
        };
    ];
}








