/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var schema = new Schema({

    createdAt: { type: Date, default: Date.now },
   
    projectId: { type: String, ref: 'Project' },
    scheduleId: {type: String, ref: 'Schedule'},
    activeEscalationId: {type: String, ref: 'Escalation'},
    incidentId: {type: String, ref: 'Incident'},
    incidentAcknowledged: {type: Boolean, default: false}, //Incident attached to this schedule is acknowledged. 
    deleted: { type: Boolean, default: false},
    deletedAt: { type: Date },
    deletedById: { type: String, ref: 'User' },

});

module.exports = mongoose.model('OnCallScheduleStatus', schema);