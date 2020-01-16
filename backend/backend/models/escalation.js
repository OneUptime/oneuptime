var mongoose = require('../config/db');

var Schema = mongoose.Schema;
const teamSchema = new Schema({
    rotationStartTime: { type: String, default: null },
    rotationEndTime: { type: String, default: null },
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
    projectId: { type: String, ref: 'Project', alias: 'project', default: null },
    activeTeamId: String,
    activeTeam: teamSchema,
    estimatedSwitchTime: String,
    callFrequency: { type: String, default: null },
    emailFrequency: { type: String, default: null },
    smsFrequency: { type: String, default: null },
    rotationFrequency: { type: String, default: null },
    rotationInterval: { type: Number, default: null },
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