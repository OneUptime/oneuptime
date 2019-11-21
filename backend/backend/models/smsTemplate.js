/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var smsTemplateSchema = new Schema({
    projectId: { type: String, ref: 'Project' },
    body: { type: String },
    smsType: {
        type: String,
        enum: ['Subscriber Incident', 'Team Member Incident'],
        required: true
    },
    allowedVariables: [{ type: String, required: true }],
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});

module.exports = mongoose.model('SmsTemplate', smsTemplateSchema);