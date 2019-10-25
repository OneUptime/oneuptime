var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var escalationSchema = new Schema({
    projectId: { type: String, ref: 'Project', alias: 'project' },
    callFrequency: String,
    createdById: { type: String, ref: 'User' },
    scheduleId: String,
    teamMember: [
        {
            call: {type: Boolean, default: false},
            email: {type: Boolean, default: false},
            sms: {type: Boolean, default: false},
            startTime: String,
            endTime: String,
            timezone: String,
            member:{type: String, ref: 'User'}
        }
    ],
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false},

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('Escalation', escalationSchema);