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
    deleted: { type: Boolean, default: false, select: false },
    
    deletedAt: {
        type: Date,
        select: false
    },

    deletedById: { type: String, ref: 'User', select: false },
    __v: { type: Number, select: false }
});

module.exports = mongoose.model('Alert', alertSchema);