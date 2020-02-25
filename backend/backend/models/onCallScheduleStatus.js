/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const schema = new Schema({

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

    alertedEveryone: { type: Boolean, default: false}, //this happens when everyone in the scheudle has been alerted and they still ignore the incident. 
});

module.exports = mongoose.model('OnCallScheduleStatus', schema);