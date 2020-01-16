var mongoose = require('../config/db');

var Schema = mongoose.Schema;
const teamSchema = new Schema({
    rotationStartTime: String,
    rotationEndTime: String,
    teamMember: [
        {
            startTime: String,
            endTime: String,
            timezone: String,
            member:{type: String, ref: 'User'}
        }
    ],
});

var escalationSchema = new Schema({
    projectId: { type: String, ref: 'Project', alias: 'project' },
    rotationStarted: { type: String, default: false },
    activeTeam: String,
    callFrequency: String,
    emailFrequency: String,
    smsFrequency: String,
    rotationFrequency: String,
    rotationInterval: Number,
    call: {type: Boolean, default: false},
    email: {type: Boolean, default: false},
    sms: {type: Boolean, default: false},
    createdById: { type: String, ref: 'User' },
    scheduleId: String,
    team: [teamSchema],
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false},

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('Escalation', escalationSchema);