import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import TeamMemberSchema from './EscalationTeamMember';
import OnCallDutySchedule from './OnCallDutySchedule';

@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    project!: Project
 
 @Column()
    callReminders:number;
 
 @Column()
    emailReminders:number;
 
 @Column()
    smsReminders:number;
 
 @Column()
    pushReminders:number;
 
 @Column()
    rotateBy: string;
 
 @Column()
    rotationInterval:number;
 
 @Column()
    firstRotationOn!: Date;
 
 @Column()
    rotationTimezone!: string;
 
 @Column()
    call!: boolean;
 
 @Column()
    email!: boolean;
 
 @Column()
    sms!: boolean;
 
 @Column()
    push!: boolean;
 
 @Column()
    createdByUser!: User;
 
 @Column()
    schedule!: OnCallDutySchedule;
 
 @Column()
    deletedByUser!: User;
}









