const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const teamSchema = new Schema({
    teamMembers: [
        {
            startTime: Date,
            endTime: Date,
            timezone: String,
            userId: { type: String, ref: 'User', index: true, default: null },
            groupId: {
                type: String,
                ref: 'Groups',
                index: true,
                default: null,
            },
        },
    ],
});

const groupSchema = new Schema({
    teamMembers: [
        {
            startTime: Date,
            endTime: Date,
            timezone: String,
            groupId: { type: String, ref: 'Groups', index: true },
        },
    ],
});

const escalationSchema = new Schema({
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
    teams: { type: [teamSchema], default: null },
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },
    groups: { type: [groupSchema], default: null },
    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
});

escalationSchema.virtual('teams.teamMembers.user', {
    ref: 'User',
    localField: 'teams.teamMembers.userId',
    foreignField: '_id',
    justOne: true,
});

escalationSchema.virtual('groups.teamMembers.groups', {
    ref: 'Groups',
    localField: 'groups.teamMembers.groupId',
    foreignField: '_id',
    justOne: true,
});

module.exports = mongoose.model('Escalation', escalationSchema);
