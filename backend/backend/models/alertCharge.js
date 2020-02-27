/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const alertChargeSchema = new Schema({
    projectId: { type: String, ref: 'Project' },
    chargeAmount: { type: Number, default: 0 },
    closingAccountBalance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    alertId: { type: String, ref: 'Alert' },
    monitorId: { type: String, ref: 'Monitor' },
    incidentId: { type: String, ref: 'Incident' },
    sentTo: { type: String },
});

module.exports = mongoose.model('AlertCharge', alertChargeSchema);
