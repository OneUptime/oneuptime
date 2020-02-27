/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const smsTemplateSchema = new Schema({
    projectId: { type: String, ref: 'Project' },
    body: { type: String },
    smsType: {
        type: String,
        enum: [
            'Subscriber Incident Created',
            'Subscriber Incident Acknowldeged',
            'Subscriber Incident Resolved',
            'Team Member Incident',
        ],
        required: true,
    },
    allowedVariables: [{ type: String, required: true }],
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User' },
});

module.exports = mongoose.model('SmsTemplate', smsTemplateSchema);
