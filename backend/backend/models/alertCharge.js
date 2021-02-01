/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const alertChargeSchema = new Schema({
    projectId: { type: String, ref: 'Project',index: true },
    chargeAmount: { type: Number, default: 0 },
    closingAccountBalance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    alertId: { type: String, ref: 'Alert',index: true },
    subscriberAlertId: { type: String, ref: 'SubscriberAlert', index: true },
    monitorId: { type: Schema.Types.ObjectId, ref: 'Monitor', index: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident',index: true },
    sentTo: { type: String },
});

module.exports = mongoose.model('AlertCharge', alertChargeSchema);
