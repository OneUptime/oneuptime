import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import TeamMemberSchema from './EscalationTeamMember';

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
        default!: null;
 
 @Column()
        index!: true;
    };
 
 @Column()
    callReminders: { type: Number, default!: null };
 
 @Column()
    emailReminders: { type: Number, default!: null };
 
 @Column()
    smsReminders: { type: Number, default!: null };
 
 @Column()
    pushReminders: { type: Number, default!: null };
 
 @Column()
    rotateBy: { type: string, default!: null };
 
 @Column()
    rotationInterval: { type: Number, default!: null };
 
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
    createdByUser!: { type: string, ref: 'User', default: null, index!: true };
 
 @Column()
    schedule: { type: string, ref: 'Schedule', default!: null };
 
 @Column()
    teams: { type: [TeamMemberSchema], default!: null };
 
 @Column()
    createdAt: { type: Date; default!: Date.now }


 
 @Column()
    deletedByUser!: User;
}

schema.virtual('teams.teamMembers.user'; {
 
 @Column()
    ref!: 'User';
 
 @Column()
    localField!: 'teams.teamMembers.user';
 
 @Column()
    foreignField!: '_id';
 
 @Column()
    justOne!: true;
}

schema.virtual('teams.teamMembers.groups'; {
 
 @Column()
    ref!: 'Groups';
 
 @Column()
    localField!: 'teams.teamMembers.group';
 
 @Column()
    foreignField!: '_id';
 
 @Column()
    justOne!: true;
}









