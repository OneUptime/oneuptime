var mongoose = require('../config/db');

var Schema = mongoose.Schema;
const teamSchema = new Schema({
    teamMembers: [
        {
            startTime: Date,
            endTime: Date,
            timezone: String,
            userId:{type: String, ref: 'User'}
        }
    ],
});

var escalationSchema = new Schema({
    projectId: { type: String, ref: 'Project', alias: 'project', default: null },
    callFrequency: { type: Number, default: null },
    emailFrequency: { type: Number, default: null },
    smsFrequency: { type: Number, default: null },
    rotationFrequency: { type: String, default: null },
    rotationInterval: { type: Number, default: null },
    rotationSwitchTime: Date,
    rotationTimezone: String,
    call: {type: Boolean, default: false},
    email: {type: Boolean, default: false},
    sms: {type: Boolean, default: false},
    createdById: { type: String, ref: 'User', default: null },
    scheduleId: { type: String, default: null },
    team: { type: [teamSchema], default: null },
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false},

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('Escalation', escalationSchema);