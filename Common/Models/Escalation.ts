import BaseModel from './BaseModel';
import TeamMemberSchema from './EscalationTeamMember';

export default interface Model extends BaseModel{
    project: {
        type: string,
        ref: 'Project',
        alias: 'project',
        default: null,
        index: true,
    },
    callReminders: { type: Number, default: null },
    emailReminders: { type: Number, default: null },
    smsReminders: { type: Number, default: null },
    pushReminders: { type: Number, default: null },
    rotateBy: { type: string, default: null },
    rotationInterval: { type: Number, default: null },
    firstRotationOn: Date,
    rotationTimezone: string,
    call: { type: Boolean, default: false },
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false },
    push: { type: Boolean, default: false },
    createdByUser: { type: string, ref: 'User', default: null, index: true },
    scheduleId: { type: string, ref: 'Schedule', default: null },
    teams: { type: [TeamMemberSchema], default: null },
    createdAt: { type: Date, default: Date.now }


    deletedByUser: User,
}

schema.virtual('teams.teamMembers.user', {
    ref: 'User',
    localField: 'teams.teamMembers.user',
    foreignField: '_id',
    justOne: true,
}

schema.virtual('teams.teamMembers.groups', {
    ref: 'Groups',
    localField: 'teams.teamMembers.groupId',
    foreignField: '_id',
    justOne: true,
}









