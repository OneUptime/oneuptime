import mongoose, { RequiredFields, UniqueFields } from '../infrastructure/ORM';
import TeamMemberSchema from './EscalationTeamMember';

const Schema = mongoose.Schema;

const schema = new Schema({
    projectId: {
        type: String,
        ref: 'Project',
        alias: 'project',
        default: null,
        index: true,
    },
    callReminders: { type: Number, default: null },
    emailReminders: { type: Number, default: null },
    smsReminders: { type: Number, default: null },
    pushReminders: { type: Number, default: null },
    rotateBy: { type: String, default: null },
    rotationInterval: { type: Number, default: null },
    firstRotationOn: Date,
    rotationTimezone: String,
    call: { type: Boolean, default: false },
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false },
    push: { type: Boolean, default: false },
    createdById: { type: String, ref: 'User', default: null, index: true },
    scheduleId: { type: String, ref: 'Schedule', default: null },
    teams: { type: [TeamMemberSchema], default: null },
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
});

schema.virtual('teams.teamMembers.user', {
    ref: 'User',
    localField: 'teams.teamMembers.userId',
    foreignField: '_id',
    justOne: true,
});

schema.virtual('teams.teamMembers.groups', {
    ref: 'Groups',
    localField: 'teams.teamMembers.groupId',
    foreignField: '_id',
    justOne: true,
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];

export const sligifyField: string = '';

export default mongoose.model('Escalation', schema);
