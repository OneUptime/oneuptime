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
    callRetries: { type: Number, default: null },
    emailRetries: { type: Number, default: null },
    smsRetries: { type: Number, default: null },
    rotateBy: { type: String, default: null },
    rotationInterval: { type: Number, default: null },
    firstRotationOn: Date,
    rotationTimezone: String,
    call: {type: Boolean, default: false},
    email: {type: Boolean, default: false},
    sms: {type: Boolean, default: false},
    createdById: { type: String, ref: 'User', default: null },
    scheduleId: { type: String, default: null },
    teams: { type: [teamSchema], default: null },
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false},

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('Escalation', escalationSchema);