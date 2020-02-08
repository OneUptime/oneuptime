/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var schema = new Schema({

    createdAt: { type: Date, default: Date.now },
   
    project: { type: Schema.Types.ObjectId, ref: 'Project' },
    schedule: {type: Schema.Types.ObjectId, ref: 'Schedule'},
    activeEscalation: {type: Schema.Types.ObjectId, ref: 'Escalation'},

    escalations:[{
        escalation: {type: Schema.Types.ObjectId, ref: 'Escalation'},
        callRemindersSent: {type: Number, default: 0},
        smsRemindersSent: {type: Number, default: 0},
        emailRemindersSent: {type: Number, default: 0}
    }],
    
    incident: {type: Schema.Types.ObjectId, ref: 'Incident'},
    incidentAcknowledged: {type: Boolean, default: false}, //Incident attached to this schedule is acknowledged. 
    deleted: { type: Boolean, default: false},
    deletedAt: { type: Date },
    deletedById: { type: String, ref: 'User' },

});

module.exports = mongoose.model('OnCallScheduleStatus', schema);