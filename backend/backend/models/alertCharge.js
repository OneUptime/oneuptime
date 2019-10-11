/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var alertChargeSchema = new Schema({
    projectId: { type: String, ref: 'Project'},
    chargeAmount: { type: Number, default: 0 },
    closingAccountBalance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    alertId : { type: String, ref: 'Alert' },
    monitorId: { type: String, ref: 'Monitor' },
    incidentId: { type: String, ref: 'Incident' },
    sentTo: { type: String }
});

module.exports = mongoose.model('AlertCharge', alertChargeSchema);