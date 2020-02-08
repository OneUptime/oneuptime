/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var alertSchema = new Schema({
    projectId: { type: String, ref: 'Project' },
    userId: { type: String, ref: 'User' },
    alertVia: String,
    alertStatus: String,
    monitorId: { type: String, ref: 'Monitor' },
    createdAt: { type: Date, default: Date.now },
    incidentId : { type: String, ref: 'Incident' },
    onCallScheduleStatus: {type: Schema.Types.ObjectId, ref: 'OnCallScheduleStatus'},
    schedule: {type: Schema.Types.ObjectId, ref: 'Schedule'},
    escalation: {type: Schema.Types.ObjectId, ref: 'Escalation'},
    error: { type: Boolean, default: false },
    errorMessage:String,
    deleted: { type: Boolean, default: false},

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});

module.exports = mongoose.model('Alert', alertSchema);